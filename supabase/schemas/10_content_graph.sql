-- Content graph: tracks which pages depend on which product features/UI
-- ("entities"), and the mechanical link graph between pages themselves — so a
-- change (new login method, a UI redesign) can be traced to every page that
-- might need updating, text or media, instead of relying on memory/grep.

CREATE TYPE entity_link_kind AS ENUM ('text', 'media', 'both');
CREATE TYPE entity_link_status AS ENUM ('ok', 'stale', 'gap');
CREATE TYPE graph_extract_job_status AS ENUM ('pending', 'running', 'done', 'failed');
CREATE TYPE entity_audit_job_status AS ENUM ('pending', 'running', 'done', 'failed');
CREATE TYPE entity_suggest_job_status AS ENUM ('pending', 'running', 'done', 'failed');

-- A trackable "thing" in the product: a UI feature, a flow, a concept.
-- reference_image_url is what "current" looks like — read by a future AI
-- audit pass; for now it's just shown in the graph side panel.
CREATE TABLE content_entities (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 text        NOT NULL,
  description          text,
  reference_image_url  text,
  version_tag          text,
  changed_at           timestamptz,   -- set by "mark changed" — drives staleness
  change_note          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- A page's dependency on an entity. `status`/`source` are ready for a future
-- AI classifier (source='ai') but today only ever written source='manual',
-- status='ok'. "Needs attention" is derived, not stored: status != 'ok' OR
-- entity.changed_at > reviewed_at — keeps the schema honest about what it
-- actually knows vs. what the UI computes.
CREATE TABLE page_entity_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  entity_id    uuid        NOT NULL REFERENCES content_entities(id) ON DELETE CASCADE,
  kind         entity_link_kind NOT NULL DEFAULT 'text',
  block_path   text,          -- optional: specific block (extract.ts-style path); null = whole-page relevance
  excerpt      text,          -- snippet or image URL captured at link time, for the side panel
  status       entity_link_status NOT NULL DEFAULT 'ok',
  note         text,
  source       text        NOT NULL DEFAULT 'manual',
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, entity_id, block_path)
);
CREATE INDEX page_entity_links_entity_idx ON page_entity_links (entity_id);
CREATE INDEX page_entity_links_page_idx ON page_entity_links (page_id);

-- Mechanical, AI-free: extracted from real internal hyperlinks already in
-- page content. Cross-project links are real and expected (releases -> docs).
CREATE TABLE page_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_page_id  uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id    uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  link_text     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_page_id, to_page_id)
);
CREATE INDEX page_links_to_idx ON page_links (to_page_id);

-- Queue for link extraction, same shape as translation_jobs. One row per
-- publish; the partial unique index collapses repeat publishes of the same
-- page into one pending job instead of piling up duplicates.
CREATE TABLE graph_extract_jobs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  status     graph_extract_job_status NOT NULL DEFAULT 'pending',
  attempts   int         NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX graph_extract_jobs_active_uniq ON graph_extract_jobs (page_id) WHERE status IN ('pending', 'running');
CREATE INDEX graph_extract_jobs_pending_idx ON graph_extract_jobs (status, created_at) WHERE status = 'pending';

CREATE TRIGGER content_entities_updated_at BEFORE UPDATE ON content_entities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER page_entity_links_updated_at BEFORE UPDATE ON page_entity_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER graph_extract_jobs_updated_at BEFORE UPDATE ON graph_extract_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enqueue extraction on every publish, from every path (editor, MCP, GitHub
-- sync, GitBook import) — page_versions is the one true choke point all four
-- go through, unlike publish_page() which two of them bypass entirely.
CREATE OR REPLACE FUNCTION enqueue_graph_extract() RETURNS trigger AS $$
BEGIN
  IF NEW.is_published THEN
    INSERT INTO graph_extract_jobs (page_id) VALUES (NEW.page_id)
    ON CONFLICT (page_id) WHERE status IN ('pending', 'running') DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER page_versions_enqueue_graph_extract
  AFTER INSERT ON page_versions
  FOR EACH ROW EXECUTE FUNCTION enqueue_graph_extract();

-- Queue for the AI stale/gap audit. One row per (entity, linked page) pair,
-- fanned out when an entity is marked changed. Same shape as
-- graph_extract_jobs — only the media/both-kind links actually need an
-- image comparison, text-only links have nothing for Gemini to look at.
CREATE TABLE entity_audit_jobs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  uuid        NOT NULL REFERENCES content_entities(id) ON DELETE CASCADE,
  page_id    uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  status     entity_audit_job_status NOT NULL DEFAULT 'pending',
  attempts   int         NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_audit_jobs_active_uniq ON entity_audit_jobs (entity_id, page_id) WHERE status IN ('pending', 'running');
CREATE INDEX entity_audit_jobs_pending_idx ON entity_audit_jobs (status, created_at) WHERE status = 'pending';
CREATE TRIGGER entity_audit_jobs_updated_at BEFORE UPDATE ON entity_audit_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Queue for AI entity-link suggestion (Phase 3). One row per page — a page
-- is checked against every entity in its project in a single Gemini call,
-- unlike entity_audit_jobs which is per (entity, page) pair. Manually
-- triggered only (a "Suggest links" button), not fanned out from the
-- page_versions trigger like graph_extract_jobs — auto-populating links a
-- human never asked for is a worse failure mode than a stale graph.
CREATE TABLE entity_suggest_jobs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  status     entity_suggest_job_status NOT NULL DEFAULT 'pending',
  attempts   int         NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_suggest_jobs_active_uniq ON entity_suggest_jobs (page_id) WHERE status IN ('pending', 'running');
CREATE INDEX entity_suggest_jobs_pending_idx ON entity_suggest_jobs (status, created_at) WHERE status = 'pending';
CREATE TRIGGER entity_suggest_jobs_updated_at BEFORE UPDATE ON entity_suggest_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: admin-only data, owner-scoped through the project, no public policies.
ALTER TABLE content_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_extract_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_audit_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_suggest_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_entities_owner_all ON content_entities FOR ALL
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = content_entities.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = content_entities.project_id AND projects.user_id = auth.uid()));

CREATE POLICY page_entity_links_owner_all ON page_entity_links FOR ALL
  USING (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = page_entity_links.page_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = page_entity_links.page_id AND projects.user_id = auth.uid()));

CREATE POLICY page_links_owner_all ON page_links FOR ALL
  USING (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = page_links.from_page_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = page_links.from_page_id AND projects.user_id = auth.uid()));

-- Unlike graph_extract_jobs (only ever written by the SECURITY DEFINER
-- trigger above, so a read-only policy is enough), entity_audit_jobs is
-- fanned out by markEntityChanged in application code — it needs read AND
-- insert from the owner's session, not just read.
CREATE POLICY entity_audit_jobs_owner_select ON entity_audit_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = entity_audit_jobs.page_id AND projects.user_id = auth.uid()));

CREATE POLICY entity_audit_jobs_owner_insert ON entity_audit_jobs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = entity_audit_jobs.page_id AND projects.user_id = auth.uid()));

CREATE POLICY graph_extract_jobs_owner_read ON graph_extract_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = graph_extract_jobs.page_id AND projects.user_id = auth.uid()));

-- Same reasoning as entity_audit_jobs — fanned out by the "Suggest links"
-- action in application code, needs read AND insert from the owner's session.
CREATE POLICY entity_suggest_jobs_owner_select ON entity_suggest_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = entity_suggest_jobs.page_id AND projects.user_id = auth.uid()));

CREATE POLICY entity_suggest_jobs_owner_insert ON entity_suggest_jobs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM pages JOIN projects ON projects.id = pages.project_id WHERE pages.id = entity_suggest_jobs.page_id AND projects.user_id = auth.uid()));
