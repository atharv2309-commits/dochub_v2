-- ──────────────────────────────────────────────────────────────────────────────
-- GitHub sync notifications (declarative source of truth)
--
-- A project optionally links to a GitHub repo (projects.github_repo, see
-- 02_tables.sql). This table is the notification/history log for that link:
-- a webhook (push to the linked branch) or a manual check inserts a 'pending'
-- row; an admin's "Review & Sync" click runs the sync and flips it to 'synced'.
-- The actual fetch-from-GitHub / convert / upsert-pages work happens in
-- application code (lib/sync/github.ts) via the service-role client, the same
-- way translation_jobs is drained by a worker outside the database.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TYPE github_sync_event_status AS ENUM ('pending', 'synced', 'dismissed');

CREATE TABLE github_sync_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha   text        NOT NULL,               -- branch head at detection time
  summary      text,                                -- e.g. "3 commits, 5 files changed"
  status       github_sync_event_status NOT NULL DEFAULT 'pending',
  detected_at  timestamptz NOT NULL DEFAULT now(),
  synced_at    timestamptz,
  synced_by    uuid        REFERENCES auth.users(id),
  UNIQUE (project_id, commit_sha)
);

-- At most one open notification per project: a second webhook delivery before
-- the first is reviewed updates the existing pending row instead of piling up.
CREATE UNIQUE INDEX github_sync_events_pending_uniq
  ON github_sync_events (project_id)
  WHERE status = 'pending';

CREATE INDEX github_sync_events_project_idx
  ON github_sync_events (project_id, detected_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE github_sync_events ENABLE ROW LEVEL SECURITY;

-- Project owner can see their own sync history/notifications (console).
CREATE POLICY "github_sync_events_owner_read" ON github_sync_events
  FOR SELECT TO authenticated
  USING (
    (SELECT user_id FROM projects WHERE id = github_sync_events.project_id) = (SELECT auth.uid())
  );

-- Writes (webhook receipt, sync completion) happen only via the service-role
-- client (webhook route has no user session; the sync engine bypasses RLS the
-- same way the translation worker does), so no client INSERT/UPDATE policy.
