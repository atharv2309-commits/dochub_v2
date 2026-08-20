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
  enabled_locales text[]      NOT NULL DEFAULT '{}',  -- non-source locales this project publishes
  -- GitHub sync source (optional). "owner/repo", GitBook Git-Sync layout
  -- (SUMMARY.md + nested .md + .gitbook/assets). NULL github_repo = unlinked.
  github_repo             text,
  github_branch           text        NOT NULL DEFAULT 'main',
  github_last_synced_sha  text,                       -- commit synced through; NULL = never synced
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
  content         jsonb,                       -- last PUBLISHED content (public reads this)
  draft_content   jsonb,                       -- pending edits (review before publish)
  draft_title     text,
  draft_description text,
  draft_updated_at timestamptz,
  link_href       text,
  status          page_status NOT NULL DEFAULT 'draft',
  -- Repo-relative source path (e.g. "device-management/overview.md") this page
  -- was synced from. NULL for pages authored directly in DocHub. Lets sync
  -- match an incoming changed file back to its page without relying on slug.
  github_path     text,
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
CREATE INDEX pages_pending_draft_idx
  ON pages (project_id, draft_updated_at DESC)
  WHERE draft_content IS NOT NULL OR status = 'draft';

-- One page per source file per project (sync's lookup key).
CREATE UNIQUE INDEX pages_github_path_idx
  ON pages (project_id, github_path)
  WHERE github_path IS NOT NULL;

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
  content                  jsonb,                          -- full BlockNote snapshot
  change_summary           text,
  is_published             boolean     NOT NULL DEFAULT false,
  published_at             timestamptz,
  restored_from_version_id uuid        REFERENCES page_versions(id) ON DELETE SET NULL,
  created_by               uuid        REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version_number)
);

-- History list per page, newest first
CREATE INDEX page_versions_page_idx
  ON page_versions (page_id, version_number DESC);

-- Fast "latest published version" lookups
CREATE INDEX page_versions_published_idx
  ON page_versions (page_id, published_at DESC)
  WHERE is_published;
