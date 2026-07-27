-- ──────────────────────────────────────────────────────────────────────────────
-- Draft workflow: all editing writes to draft_* columns; `content` only ever
-- holds the last PUBLISHED state (what the public site reads). publish_page
-- atomically applies the draft to live, snapshots a version, and clears the draft.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE pages
  ADD COLUMN draft_content    jsonb,
  ADD COLUMN draft_title      text,
  ADD COLUMN draft_description text,
  ADD COLUMN draft_updated_at timestamptz;

-- Pages with pending review (never published, or edited since last publish)
CREATE INDEX pages_pending_draft_idx
  ON pages (project_id, draft_updated_at DESC)
  WHERE draft_content IS NOT NULL OR status = 'draft';

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

    -- Regenerate slug only while the page is still a draft or carries the
    -- auto-generated default — published pages keep stable URLs.
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

    -- Cascade path change to descendants.
    IF v_new_path IS NOT NULL AND v_old_path IS NOT NULL AND v_old_path <> v_new_path THEN
      UPDATE pages
         SET path = v_new_path || substring(path FROM length(v_old_path) + 1)
       WHERE project_id = v_page.project_id
         AND path LIKE v_old_path || '/%';
    END IF;
  ELSE
    -- No pending draft: just (re)publish the current content.
    UPDATE pages SET status = 'published', updated_by = auth.uid() WHERE id = p_page_id;
  END IF;

  PERFORM create_page_version(p_page_id, true, 'Published');
END;
$$;

REVOKE ALL ON FUNCTION publish_page(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION publish_page(uuid) TO authenticated;
