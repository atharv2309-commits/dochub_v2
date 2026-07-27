import type { SupabaseClient } from '@supabase/supabase-js'
import { translatePage, computeSourceHash, type PageSource } from './translate-page'
import { extractSegments } from './extract'

const MAX_ATTEMPTS = 3
// A job claimed (running) but not finished within this window is assumed orphaned
// (worker crashed / Vercel function timed out mid-job) and is reclaimed.
const STALE_RUNNING_MS = 5 * 60_000

export interface RunResult {
  claimed: number
  done: number
  failed: number
  errors: { jobId: string; error: string }[]
}

// Recover jobs stuck in 'running' past the stale window back to 'pending' so a
// crashed/timed-out worker never strands them. Self-healing — no cron required.
async function reclaimStaleJobs(db: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString()
  await db
    .from('translation_jobs')
    .update({ status: 'pending' })
    .eq('status', 'running')
    .lt('updated_at', cutoff)
}

// Process one claimed job end-to-end. Returns 'done' | 'failed'.
async function processJob(
  db: SupabaseClient,
  job: { id: string; page_id: string; locale: string; attempts: number },
  result: RunResult
): Promise<void> {
  try {
    const { data: page } = await db
      .from('pages')
      .select('id, title, description, content, status')
      .eq('id', job.page_id)
      .single()

    if (!page || page.status !== 'published') {
      // Source vanished/unpublished — nothing to translate; close the job.
      await db.from('translation_jobs').update({ status: 'done' }).eq('id', job.id)
      result.done++
      return
    }

    // Smart skip: if the page's source is unchanged since the existing
    // translation (same source_hash) and that translation still has content,
    // there's nothing to do — clear the outdated flag without calling the engine.
    // This makes re-publishing unchanged content a true no-op.
    const sourceHash = computeSourceHash(page as PageSource, extractSegments(page.content))
    const { data: existing } = await db
      .from('page_translations')
      .select('source_hash, content, status')
      .eq('page_id', job.page_id)
      .eq('locale', job.locale)
      .maybeSingle()
    if (existing?.content && existing.source_hash === sourceHash) {
      if (existing.status === 'outdated') {
        await db
          .from('page_translations')
          .update({ status: 'machine' })
          .eq('page_id', job.page_id)
          .eq('locale', job.locale)
      }
      await db.from('translation_jobs').update({ status: 'done', error: null }).eq('id', job.id)
      result.done++
      return
    }

    const out = await translatePage(db, page as PageSource, job.locale)

    await db.from('page_translations').upsert(
      {
        page_id: job.page_id,
        locale: job.locale,
        title: out.title,
        description: out.description,
        content: out.content,
        source_hash: out.sourceHash,
        status: 'machine',
        engine: out.engine,
        translated_at: new Date().toISOString(),
      },
      { onConflict: 'page_id,locale' }
    )

    await db.from('translation_jobs').update({ status: 'done', error: null }).eq('id', job.id)
    result.done++
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = (job.attempts ?? 0) + 1
    const giveUp = attempts >= MAX_ATTEMPTS
    await db
      .from('translation_jobs')
      .update({ status: giveUp ? 'failed' : 'pending', attempts, error: message.slice(0, 500) })
      .eq('id', job.id)
    result.failed++
    result.errors.push({ jobId: job.id, error: message })
  }
}

// Claim and process one pending job atomically. Returns false when the queue is
// empty (nothing claimable). Translation: claim (pending→running) → translate →
// upsert → done. Failures retry up to MAX_ATTEMPTS, then stick at 'failed'. A
// failed job never destroys the last good translation — the previous row stays.
async function claimAndProcessOne(db: SupabaseClient, result: RunResult): Promise<boolean> {
  const { data: job } = await db
    .from('translation_jobs')
    .select('id, page_id, locale, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!job) return false

  // Atomic claim — the conditional update stops two workers grabbing the same job.
  const { data: claimed } = await db
    .from('translation_jobs')
    .update({ status: 'running' })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return true // someone else took it; keep going

  result.claimed++
  await processJob(db, job, result)
  return true
}

// Drain the queue one job at a time until it's empty or the time budget is hit.
// Checking the deadline per job (not per batch) keeps the worker safely under
// Vercel's function limit. Returns whether pending jobs remain so the caller can
// self-trigger a fresh invocation to continue — no cron dependency.
export async function drainTranslationJobs(
  db: SupabaseClient,
  opts: { deadlineMs?: number } = {}
): Promise<RunResult & { remaining: boolean }> {
  const deadline = opts.deadlineMs ?? Date.now() + 250_000
  const totals: RunResult = { claimed: 0, done: 0, failed: 0, errors: [] }

  await reclaimStaleJobs(db)

  while (Date.now() < deadline) {
    const more = await claimAndProcessOne(db, totals)
    if (!more) break // queue empty
  }

  const { count } = await db
    .from('translation_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  return { ...totals, remaining: (count ?? 0) > 0 }
}

// Process up to `limit` pending jobs (used by the direct-drain script). The
// worker route uses drainTranslationJobs (time-budgeted) instead.
export async function runTranslationJobs(db: SupabaseClient, limit = 5): Promise<RunResult> {
  const result: RunResult = { claimed: 0, done: 0, failed: 0, errors: [] }
  await reclaimStaleJobs(db)
  for (let i = 0; i < limit; i++) {
    const more = await claimAndProcessOne(db, result)
    if (!more) break
  }
  return result
}
