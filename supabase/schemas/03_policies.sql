-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages    ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────────
-- Projects policies
-- ──────────────────────────────────────────────────────────────────────────────

-- Authenticated users can manage their own projects
CREATE POLICY "projects_owner_all" ON projects
  FOR ALL TO authenticated
  USING   ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Anonymous users can read public projects
CREATE POLICY "projects_public_read" ON projects
  FOR SELECT TO anon
  USING (visibility = 'public');

-- ──────────────────────────────────────────────────────────────────────────────
-- Pages policies
-- ──────────────────────────────────────────────────────────────────────────────

-- Project owner can manage all pages
CREATE POLICY "pages_owner_all" ON pages
  FOR ALL TO authenticated
  USING (
    (SELECT user_id FROM projects WHERE id = project_id) = (SELECT auth.uid())
  )
  WITH CHECK (
    (SELECT user_id FROM projects WHERE id = project_id) = (SELECT auth.uid())
  );

-- Anonymous users can read published non-hidden pages in public projects
CREATE POLICY "pages_public_read" ON pages
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND hidden = false
    AND (SELECT visibility FROM projects WHERE id = project_id) = 'public'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Page version history policies (read-only for clients; writes via RPC only)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

-- Project owner can read all versions of their pages
CREATE POLICY "page_versions_owner_read" ON page_versions
  FOR SELECT TO authenticated
  USING (
    (SELECT user_id FROM projects WHERE id = project_id) = (SELECT auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies: history writes go exclusively through the
-- SECURITY DEFINER RPCs (create_page_version / restore_page_version). Rows are
-- immutable; clients cannot mutate history directly.
