-- ──────────────────────────────────────────────────────────────────────────────
-- Page version history (immutable, append-only snapshots)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE page_versions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id                  uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  project_id               uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number           integer     NOT NULL,
  title                    text        NOT NULL,
  description              text,
  content                  jsonb,
  change_summary           text,
  is_published             boolean     NOT NULL DEFAULT false,
  published_at             timestamptz,
  restored_from_version_id uuid        REFERENCES page_versions(id) ON DELETE SET NULL,
  created_by               uuid        REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version_number)
);

CREATE INDEX page_versions_page_idx
  ON page_versions (page_id, version_number DESC);

CREATE INDEX page_versions_published_idx
  ON page_versions (page_id, published_at DESC)
  WHERE is_published;

-- RLS: read-only for owners; writes via RPC only
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "page_versions_owner_read" ON page_versions
  FOR SELECT TO authenticated
  USING (
    (SELECT user_id FROM projects WHERE id = project_id) = (SELECT auth.uid())
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Snapshot + restore RPCs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_page_version(
  p_page_id        uuid,
  p_is_published   boolean DEFAULT false,
  p_change_summary text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page pages%ROWTYPE;
  v_next integer;
  v_id   uuid;
BEGIN
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  IF (SELECT user_id FROM projects WHERE id = v_page.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM page_versions
   WHERE page_id = p_page_id;

  INSERT INTO page_versions (
    page_id, project_id, version_number, title, description, content,
    change_summary, is_published, published_at, created_by
  ) VALUES (
    v_page.id, v_page.project_id, v_next, v_page.title, v_page.description, v_page.content,
    p_change_summary, p_is_published,
    CASE WHEN p_is_published THEN now() ELSE NULL END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_page_version(p_version_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver page_versions%ROWTYPE;
  v_new uuid;
BEGIN
  SELECT * INTO v_ver FROM page_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version % not found', p_version_id;
  END IF;

  IF (SELECT user_id FROM projects WHERE id = v_ver.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE pages
     SET content     = v_ver.content,
         title       = v_ver.title,
         description = v_ver.description,
         updated_by  = auth.uid()
   WHERE id = v_ver.page_id;

  SELECT create_page_version(
           v_ver.page_id,
           true,
           'Restored from version ' || v_ver.version_number
         ) INTO v_new;

  UPDATE page_versions
     SET restored_from_version_id = v_ver.id
   WHERE id = v_new;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION create_page_version(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION restore_page_version(uuid)               FROM public, anon;
GRANT EXECUTE ON FUNCTION create_page_version(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_page_version(uuid)               TO authenticated;
