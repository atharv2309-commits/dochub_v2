-- ──────────────────────────────────────────────────────────────────────────────
-- Document translation (declarative source of truth)
--
-- Per-locale page translations, a translation-memory reuse cache, and an async
-- job queue. Translations are DERIVED artifacts of the English source — never
-- hand-maintained — so the source page stays the single source of truth and the
-- system self-heals when docs change. pg_cron scheduling of the worker lives in
-- a separate operational migration (it is not declarative table DDL).
-- ──────────────────────────────────────────────────────────────────────────────

-- Status of a page's translation relative to its English source.
CREATE TYPE translation_status AS ENUM ('machine', 'reviewed', 'outdated');

-- Lifecycle of a queued translation job.
CREATE TYPE translation_job_status AS ENUM ('pending', 'running', 'done', 'failed');

-- One row per (page, locale). content mirrors the source BlockNote structure.
CREATE TABLE page_translations (
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  locale        text NOT NULL,
  title         text,
  description   text,
  content       jsonb,
  -- Hash of the source (title+description+content) this translation derives
  -- from. When it no longer matches the live source, the translation is stale.
  source_hash   text NOT NULL,
  status        translation_status NOT NULL DEFAULT 'machine',
  engine        text,
  translated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, locale)
);

CREATE INDEX page_translations_locale_idx ON page_translations (locale);

-- Translation memory: reuse cache keyed by (locale, hash of one source segment).
-- The same source phrase always maps to the same translation, everywhere —
-- giving consistency and making unchanged content free to re-process.
CREATE TABLE translation_memory (
  locale      text NOT NULL,
  source_hash text NOT NULL,
  source_text text NOT NULL,
  target_text text NOT NULL,
  engine      text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, source_hash)
);

-- Async job queue. publish_page enqueues; a worker drains.
CREATE TABLE translation_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  locale     text NOT NULL,
  status     translation_job_status NOT NULL DEFAULT 'pending',
  attempts   int  NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one queued/running job per (page, locale): re-publishing collapses
-- into the existing pending job rather than piling up duplicates.
CREATE UNIQUE INDEX translation_jobs_active_uniq
  ON translation_jobs (page_id, locale)
  WHERE status IN ('pending', 'running');

CREATE INDEX translation_jobs_pending_idx
  ON translation_jobs (status, created_at)
  WHERE status = 'pending';

CREATE TRIGGER translation_jobs_updated_at
  BEFORE UPDATE ON translation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE page_translations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_jobs   ENABLE ROW LEVEL SECURITY;

-- Public can read translations for published, non-hidden pages in public
-- projects (mirrors pages_public_read).
CREATE POLICY "page_translations_public_read" ON page_translations
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM pages p
      JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = page_translations.page_id
        AND p.status = 'published'
        AND p.hidden = false
        AND pr.visibility = 'public'
    )
  );

-- Project owner can read everything about their translations + jobs (console).
CREATE POLICY "page_translations_owner_read" ON page_translations
  FOR SELECT TO authenticated
  USING (
    (SELECT pr.user_id FROM pages p JOIN projects pr ON pr.id = p.project_id
       WHERE p.id = page_translations.page_id) = (SELECT auth.uid())
  );

CREATE POLICY "translation_jobs_owner_read" ON translation_jobs
  FOR SELECT TO authenticated
  USING (
    (SELECT pr.user_id FROM pages p JOIN projects pr ON pr.id = p.project_id
       WHERE p.id = translation_jobs.page_id) = (SELECT auth.uid())
  );

-- Writes to all three tables happen only via the service-role worker / RPCs
-- (which bypass RLS), so no client INSERT/UPDATE policies are granted.

-- ── Enqueue helper ─────────────────────────────────────────────────────────────
-- Queue a translation job per enabled locale for a page. Idempotent: the unique
-- partial index collapses repeats into the existing pending job.
CREATE OR REPLACE FUNCTION enqueue_page_translations(p_page_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_locale     text;
BEGIN
  SELECT project_id INTO v_project_id FROM pages WHERE id = p_page_id;
  IF v_project_id IS NULL THEN RETURN; END IF;

  FOR v_locale IN
    SELECT unnest(enabled_locales) FROM projects WHERE id = v_project_id
  LOOP
    -- Mark any existing translation outdated immediately, so the public site
    -- shows the "updating" state until the worker catches up.
    UPDATE page_translations
       SET status = 'outdated'
     WHERE page_id = p_page_id AND locale = v_locale AND status <> 'reviewed';

    INSERT INTO translation_jobs (page_id, locale, status)
    VALUES (p_page_id, v_locale, 'pending')
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_page_translations(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION enqueue_page_translations(uuid) TO authenticated;

-- ── Console mutations (owner-checked) ─────────────────────────────────────────
-- Manually (re)queue translation for specific pages/locales — backs the "Re-
-- translate" / "Translate missing" actions. Ownership is enforced here because
-- the worker tables have no client write policies.
-- p_only_stale = true queues only pages that are missing a translation or are
-- outdated for a locale (the "Translate missing & outdated" action); false
-- re-translates every page (marking current non-reviewed ones outdated first).
CREATE OR REPLACE FUNCTION request_translations(
  p_project_id uuid,
  p_locales    text[],
  p_only_stale boolean DEFAULT false
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_page  uuid;
  v_loc   text;
  v_state translation_status;
BEGIN
  IF (SELECT user_id FROM projects WHERE id = p_project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOR v_page IN
    SELECT id FROM pages
     WHERE project_id = p_project_id AND status = 'published' AND hidden = false
  LOOP
    FOREACH v_loc IN ARRAY p_locales LOOP
      SELECT status INTO v_state
        FROM page_translations WHERE page_id = v_page AND locale = v_loc;

      -- In stale-only mode, skip locales that are already current (machine or
      -- reviewed). NULL (no row) and 'outdated' always proceed.
      IF p_only_stale AND v_state IN ('machine', 'reviewed') THEN
        CONTINUE;
      END IF;

      UPDATE page_translations SET status = 'outdated'
        WHERE page_id = v_page AND locale = v_loc AND status <> 'reviewed';
      INSERT INTO translation_jobs (page_id, locale, status)
      VALUES (v_page, v_loc, 'pending')
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION request_translations(uuid, text[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION request_translations(uuid, text[], boolean) TO authenticated;

-- Queue (re)translation for a single page across the given locales. Backs the
-- per-page "Translate" control in the editor.
CREATE OR REPLACE FUNCTION request_page_translations(p_page_id uuid, p_locales text[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_loc   text;
BEGIN
  IF (SELECT pr.user_id FROM pages p JOIN projects pr ON pr.id = p.project_id
        WHERE p.id = p_page_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOREACH v_loc IN ARRAY p_locales LOOP
    UPDATE page_translations SET status = 'outdated'
      WHERE page_id = p_page_id AND locale = v_loc AND status <> 'reviewed';
    INSERT INTO translation_jobs (page_id, locale, status)
    VALUES (p_page_id, v_loc, 'pending')
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION request_page_translations(uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION request_page_translations(uuid, text[]) TO authenticated;

-- Toggle a translation's reviewed flag (human sign-off that survives re-runs).
CREATE OR REPLACE FUNCTION set_translation_reviewed(p_page_id uuid, p_locale text, p_reviewed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT pr.user_id FROM pages p JOIN projects pr ON pr.id = p.project_id
        WHERE p.id = p_page_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE page_translations
     SET status = CASE WHEN p_reviewed THEN 'reviewed'::translation_status
                       ELSE 'machine'::translation_status END
   WHERE page_id = p_page_id AND locale = p_locale;
END;
$$;

REVOKE ALL ON FUNCTION set_translation_reviewed(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_translation_reviewed(uuid, text, boolean) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- Do-not-translate glossary
--
-- Platform UI terms authors reference in prose (e.g. "Operations Dashboard")
-- that must never be machine-translated — the reader needs the exact label
-- they'll see in the actual product UI, not a translated approximation.
-- Self-serve: admins manage this list from /admin/translations, no code
-- change needed. Applied in lib/translation/translate-page.ts, engine-agnostic
-- (placeholder substitution around whichever TranslationEngine is active), so
-- it protects terms regardless of which engine is configured.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE translation_glossary (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  term       text        NOT NULL UNIQUE,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER translation_glossary_updated_at
  BEFORE UPDATE ON translation_glossary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE translation_glossary ENABLE ROW LEVEL SECURITY;

-- Single-org install (same model as mcp_api_keys) — any authenticated admin
-- manages the shared glossary; no per-project/per-owner scoping needed here.
CREATE POLICY "translation_glossary_authenticated_all" ON translation_glossary
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
