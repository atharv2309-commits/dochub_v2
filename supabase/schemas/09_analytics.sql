-- ──────────────────────────────────────────────────────────────────────────────
-- Docs-specific analytics (declarative source of truth)
--
-- GA4 covers generic traffic/session analytics on its own (client-side gtag.js,
-- no schema needed here). This is the layer GA4 can't see: an append-only log
-- of docs-specific reader intent (search queries — especially the ones that
-- come up empty — PDF/copy/markdown/MCP actions, and per-page feedback), tied
-- to our own content and translation state. A periodic job aggregates this log
-- and asks an LLM to synthesize it into plain-English findings (content gaps,
-- dead-end pages, rising topics) — see analytics_insights below.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TYPE page_event_type AS ENUM (
  'search_query',
  'search_zero_result',
  'pdf_download',
  'copy_page',
  'view_markdown',
  'open_chatgpt',
  'open_claude',
  'mcp_connect_click',
  'feedback'
);

CREATE TABLE page_events (
  id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id    uuid            REFERENCES pages(id) ON DELETE SET NULL, -- null for page-less events (e.g. a project-wide search)
  event_type page_event_type NOT NULL,
  locale     text,
  query_text text,                     -- search_query / search_zero_result
  helpful    boolean,                  -- feedback
  comment    text,                     -- feedback (optional free text)
  created_at timestamptz     NOT NULL DEFAULT now()
);

-- The digest job's hot path: "everything for this project in the last N days".
CREATE INDEX page_events_project_created_idx ON page_events (project_id, created_at DESC);
CREATE INDEX page_events_type_idx ON page_events (project_id, event_type, created_at DESC);

ALTER TABLE page_events ENABLE ROW LEVEL SECURITY;

-- Anonymous readers write their own events, but only into a public project —
-- prevents using this as a write path into private/nonexistent projects.
CREATE POLICY "page_events_public_insert" ON page_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE id = page_events.project_id AND visibility = 'public')
  );

-- Only the project owner can read their own raw event log (console).
CREATE POLICY "page_events_owner_read" ON page_events
  FOR SELECT TO authenticated
  USING ((SELECT user_id FROM projects WHERE id = page_events.project_id) = (SELECT auth.uid()));

-- Append-only: no UPDATE/DELETE policy for anyone (service-role can still
-- manage it directly if ever needed — RLS doesn't apply to that role).

-- ── Stored digests ───────────────────────────────────────────────────────────
-- One row per digest run. Written only by the service-role generation job
-- (app/api/analytics/generate-insights), never by clients.
CREATE TABLE analytics_insights (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  summary      jsonb       NOT NULL, -- { contentGaps: [...], deadEndPages: [...], risingTopics: [...], highlights: [...] }
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_insights_project_idx ON analytics_insights (project_id, created_at DESC);

ALTER TABLE analytics_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_insights_owner_read" ON analytics_insights
  FOR SELECT TO authenticated
  USING ((SELECT user_id FROM projects WHERE id = analytics_insights.project_id) = (SELECT auth.uid()));
