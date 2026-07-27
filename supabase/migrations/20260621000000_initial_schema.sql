-- Page content type enum
CREATE TYPE page_kind AS ENUM ('document', 'group', 'link');

-- Page publish status
CREATE TYPE page_status AS ENUM ('draft', 'published');

-- Cover image display style
CREATE TYPE cover_style AS ENUM ('full', 'content');
-- Projects (equivalent to Gitbook Spaces)
CREATE TABLE projects (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  slug            text        NOT NULL,
  description     text,
  icon            text,
  cover_image_url text,
  visibility      text        NOT NULL DEFAULT 'public'
                              CHECK (visibility IN ('public', 'private', 'unlisted')),
  theme           jsonb       NOT NULL DEFAULT '{}',
  custom_domain   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

-- Pages (with nested subpages via parent_id)
CREATE TABLE pages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id       uuid        REFERENCES pages(id) ON DELETE CASCADE,
  kind            page_kind   NOT NULL DEFAULT 'document',
  title           text        NOT NULL,
  link_title      text,
  slug            text        NOT NULL,
  path            text        NOT NULL,
  description     text,
  icon            text,
  cover_image_url text,
  cover_style     cover_style DEFAULT 'content',
  order_index     float8      NOT NULL DEFAULT 0,
  hidden          boolean     NOT NULL DEFAULT false,
  no_index        boolean     NOT NULL DEFAULT false,
  tags            text[]      NOT NULL DEFAULT '{}',
  primary_tag     text,
  layout          jsonb       NOT NULL DEFAULT '{}',
  content         jsonb,
  link_href       text,
  status          page_status NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES auth.users(id),
  updated_by      uuid        REFERENCES auth.users(id),
  UNIQUE (project_id, path)
);

-- Indexes for common queries
CREATE INDEX pages_project_id_idx ON pages (project_id);
CREATE INDEX pages_parent_id_idx ON pages (parent_id);
CREATE INDEX pages_path_idx ON pages (project_id, path);
CREATE INDEX pages_status_idx ON pages (project_id, status);

-- updated_at auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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
