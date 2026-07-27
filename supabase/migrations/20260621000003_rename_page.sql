-- ──────────────────────────────────────────────────────────────────────────────
-- rename_page: regenerate slug from title, ensure uniqueness within the project,
-- and cascade the path change to all descendants. Slug only regenerates while the
-- page is a draft or carries the auto-generated default ('untitled%') so that
-- published pages keep stable URLs.
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

  IF v_page.slug NOT LIKE 'untitled%' AND v_page.status <> 'draft' THEN
    UPDATE pages SET title = v_title, updated_by = auth.uid() WHERE id = p_page_id;
    RETURN v_page.path;
  END IF;

  v_base_slug := trim(both '-' from regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'));
  IF v_base_slug = '' THEN
    v_base_slug := 'untitled';
  END IF;

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
