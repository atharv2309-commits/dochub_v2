-- ──────────────────────────────────────────────────────────────────────────────
-- Supabase-native scheduling for the translation worker. pg_cron fires every
-- minute and pg_net POSTs to the Vercel worker route, which drains the job
-- queue. This keeps scheduling inside Supabase (always-on, per-minute on any
-- plan) rather than depending on Vercel Cron's once-a-day Hobby limit.
--
-- PREREQUISITES (run once, with your real values — secrets live in Vault, never
-- in this file or git):
--   select vault.create_secret('https://YOUR-APP.vercel.app/api/translation/worker',
--                               'translation_worker_url');
--   select vault.create_secret('YOUR_WORKER_SECRET', 'translation_worker_secret');
-- The same secret must be set as TRANSLATION_WORKER_SECRET in Vercel.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- POST to the worker, pulling URL + bearer secret from Vault at call time.
CREATE OR REPLACE FUNCTION trigger_translation_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'translation_worker_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'translation_worker_secret';

  -- Skip quietly until configured, so the cron job is harmless pre-deploy.
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  -- Only fire when there's actually work, to avoid needless invocations.
  IF NOT EXISTS (SELECT 1 FROM translation_jobs WHERE status = 'pending') THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION trigger_translation_worker() FROM public, anon, authenticated;

-- Schedule every minute (idempotent: unschedule any prior definition first).
DO $$
BEGIN
  PERFORM cron.unschedule('translation-worker');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('translation-worker', '* * * * *', $$SELECT trigger_translation_worker();$$);
