-- ──────────────────────────────────────────────────────────────────────────────
-- Page version history RPCs (snapshot + restore)
-- Writes to page_versions go exclusively through these SECURITY DEFINER functions
-- so version numbering stays atomic and created_by is trustworthy (auth.uid()).
-- ──────────────────────────────────────────────────────────────────────────────

-- Snapshot the current state of a page into history. Returns the new version id.
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
  -- Lock the page row to serialize version numbering for this page.
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  -- Authorization: caller must own the project this page belongs to.
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

-- Restore an old version: copy its content back onto the live page, then record
-- the restore as a brand-new version. History is forward-only (never rewritten).
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

-- ──────────────────────────────────────────────────────────────────────────────
-- Rename a page: regenerate slug from title, ensure uniqueness within the
-- project, and cascade the path change to all descendants. Atomic + authorized.
-- Slug is only regenerated while the page is still a draft or carries the
-- auto-generated default ('untitled%') — published pages keep stable URLs.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rename_page(p_page_id uuid, p_title text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page        pages%ROWTYPE;
  v_title       text;
  v_parent_path text;
  v_base_slug   text;
  v_slug        text;
  v_new_path    text;
  v_old_path    text;
  v_suffix      integer := 1;
BEGIN
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  IF (SELECT user_id FROM projects WHERE id = v_page.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_title := COALESCE(NULLIF(trim(p_title), ''), 'Untitled');

  -- Keep published pages' slugs stable: only update the title.
  IF v_page.slug NOT LIKE 'untitled%' AND v_page.status <> 'draft' THEN
    UPDATE pages SET title = v_title, updated_by = auth.uid() WHERE id = p_page_id;
    RETURN v_page.path;
  END IF;

  -- Slugify: lowercase, non-alphanumerics → '-', collapse and trim dashes.
  v_base_slug := trim(both '-' from regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'));
  IF v_base_slug = '' THEN
    v_base_slug := 'untitled';
  END IF;

  IF v_page.parent_id IS NOT NULL THEN
    SELECT path INTO v_parent_path FROM pages WHERE id = v_page.parent_id;
  END IF;

  -- Ensure path uniqueness within the project.
  v_slug := v_base_slug;
  LOOP
    v_new_path := CASE
      WHEN v_parent_path IS NULL OR v_parent_path = '' THEN v_slug
      ELSE v_parent_path || '/' || v_slug
    END;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM pages
      WHERE project_id = v_page.project_id
        AND path = v_new_path
        AND id <> p_page_id
    );
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  v_old_path := v_page.path;

  UPDATE pages
     SET title = v_title, slug = v_slug, path = v_new_path, updated_by = auth.uid()
   WHERE id = p_page_id;

  -- Cascade the path change to all descendants (path prefix rewrite).
  IF v_old_path <> v_new_path THEN
    UPDATE pages
       SET path = v_new_path || substring(path FROM length(v_old_path) + 1)
     WHERE project_id = v_page.project_id
       AND path LIKE v_old_path || '/%';
  END IF;

  RETURN v_new_path;
END;
$$;

REVOKE ALL ON FUNCTION rename_page(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION rename_page(uuid, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- publish_page: apply pending draft to live content, snapshot a version, clear
-- the draft. Editing always writes to draft_*; content holds only published state.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION publish_page(p_page_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page        pages%ROWTYPE;
  v_title       text;
  v_base_slug   text;
  v_slug        text;
  v_new_path    text;
  v_old_path    text;
  v_parent_path text;
  v_suffix      integer := 1;
BEGIN
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  IF (SELECT user_id FROM projects WHERE id = v_page.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF v_page.draft_content IS NOT NULL THEN
    v_title := COALESCE(NULLIF(trim(v_page.draft_title), ''), v_page.title);

    IF v_title <> v_page.title AND (v_page.slug LIKE 'untitled%' OR v_page.status = 'draft') THEN
      v_base_slug := trim(both '-' from regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'));
      IF v_base_slug = '' THEN v_base_slug := 'untitled'; END IF;

      IF v_page.parent_id IS NOT NULL THEN
        SELECT path INTO v_parent_path FROM pages WHERE id = v_page.parent_id;
      END IF;

      v_slug := v_base_slug;
      LOOP
        v_new_path := CASE
          WHEN v_parent_path IS NULL OR v_parent_path = '' THEN v_slug
          ELSE v_parent_path || '/' || v_slug
        END;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM pages
          WHERE project_id = v_page.project_id AND path = v_new_path AND id <> p_page_id
        );
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      END LOOP;
      v_old_path := v_page.path;
    END IF;

    UPDATE pages SET
      title            = v_title,
      slug             = COALESCE(v_slug, slug),
      path             = COALESCE(v_new_path, path),
      description      = v_page.draft_description,
      content          = v_page.draft_content,
      status           = 'published',
      draft_content    = NULL,
      draft_title      = NULL,
      draft_description = NULL,
      draft_updated_at = NULL,
      updated_by       = auth.uid()
    WHERE id = p_page_id;

    IF v_new_path IS NOT NULL AND v_old_path IS NOT NULL AND v_old_path <> v_new_path THEN
      UPDATE pages
         SET path = v_new_path || substring(path FROM length(v_old_path) + 1)
       WHERE project_id = v_page.project_id
         AND path LIKE v_old_path || '/%';
    END IF;
  ELSE
    UPDATE pages SET status = 'published', updated_by = auth.uid() WHERE id = p_page_id;
  END IF;

  PERFORM create_page_version(p_page_id, true, 'Published');
  -- Queue translation refresh for all enabled locales (defined in 06_translations).
  PERFORM enqueue_page_translations(p_page_id);
END;
$$;

REVOKE ALL ON FUNCTION publish_page(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION publish_page(uuid) TO authenticated;
