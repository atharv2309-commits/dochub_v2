import type { SupabaseClient } from '@supabase/supabase-js'
import { extractPageLinks } from './extractPageLinks'

const MAX_ATTEMPTS = 3
const STALE_RUNNING_MS = 5 * 60_000

export interface RunResult {
  claimed: number
  done: number
  failed: number
  errors: { jobId: string; error: string }[]
}

async function reclaimStaleJobs(db: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString()
  await db.from('graph_extract_jobs').update({ status: 'pending' }).eq('status', 'running').lt('updated_at', cutoff)
}

async function processJob(
  db: SupabaseClient,
  job: { id: string; page_id: string; attempts: number },
  result: RunResult
): Promise<void> {
  try {
    await extractPageLinks(db, job.page_id)
    await db.from('graph_extract_jobs').update({ status: 'done', error: null }).eq('id', job.id)
    result.done++
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = (job.attempts ?? 0) + 1
    const giveUp = attempts >= MAX_ATTEMPTS
    await db
      .from('graph_extract_jobs')
      .update({ status: giveUp ? 'failed' : 'pending', attempts, error: message.slice(0, 500) })
      .eq('id', job.id)
    result.failed++
    result.errors.push({ jobId: job.id, error: message })
  }
}

async function claimAndProcessOne(db: SupabaseClient, result: RunResult): Promise<boolean> {
  const { data: job } = await db
    .from('graph_extract_jobs')
    .select('id, page_id, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!job) return false

  const { data: claimed } = await db
    .from('graph_extract_jobs')
    .update({ status: 'running' })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return true

  result.claimed++
  await processJob(db, job, result)
  return true
}

export async function drainGraphExtractJobs(
  db: SupabaseClient,
  opts: { deadlineMs?: number } = {}
): Promise<RunResult & { remaining: boolean }> {
  const deadline = opts.deadlineMs ?? Date.now() + 250_000
  const totals: RunResult = { claimed: 0, done: 0, failed: 0, errors: [] }

  await reclaimStaleJobs(db)

  while (Date.now() < deadline) {
    const more = await claimAndProcessOne(db, totals)
    if (!more) break
  }

  const { count } = await db.from('graph_extract_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  return { ...totals, remaining: (count ?? 0) > 0 }
}
