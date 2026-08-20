import type { SupabaseClient } from '@supabase/supabase-js'
import { suggestEntityLinks } from './suggest'
import { extractPageIntro } from './pageSummary'

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
  await db.from('entity_suggest_jobs').update({ status: 'pending' }).eq('status', 'running').lt('updated_at', cutoff)
}

async function processJob(
  db: SupabaseClient,
  job: { id: string; page_id: string; attempts: number },
  result: RunResult
): Promise<void> {
  try {
    const { data: page } = await db.from('pages').select('title, content, project_id').eq('id', job.page_id).single()
    if (!page) throw new Error('page not found')

    const { data: entities } = await db.from('content_entities').select('id, name, description').eq('project_id', page.project_id)

    // Don't re-suggest an entity this page already has an AI link to —
    // idempotent re-runs shouldn't spam duplicate proposals.
    const { data: existingAiLinks } = await db
      .from('page_entity_links')
      .select('entity_id')
      .eq('page_id', job.page_id)
      .eq('source', 'ai')
    const alreadySuggested = new Set((existingAiLinks ?? []).map((l) => l.entity_id))
    const candidates = (entities ?? []).filter((e) => !alreadySuggested.has(e.id))

    const matches = await suggestEntityLinks({
      pageTitle: page.title,
      pageIntro: extractPageIntro(page.content),
      entities: candidates.map((e) => ({ name: e.name, description: e.description })),
    })

    const entityIdByName = new Map(candidates.map((e) => [e.name, e.id]))
    const rows = matches
      .map((m) => ({ entity_id: entityIdByName.get(m.entityName), kind: m.kind, reason: m.reason }))
      .filter((r): r is { entity_id: string; kind: string; reason: string } => !!r.entity_id)

    if (rows.length) {
      await db.from('page_entity_links').upsert(
        rows.map((r) => ({
          page_id: job.page_id,
          entity_id: r.entity_id,
          kind: r.kind,
          note: r.reason,
          source: 'ai',
          block_path: null,
        })),
        { onConflict: 'page_id,entity_id,block_path' }
      )
    }

    await db.from('entity_suggest_jobs').update({ status: 'done', error: null }).eq('id', job.id)
    result.done++
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = (job.attempts ?? 0) + 1
    const giveUp = attempts >= MAX_ATTEMPTS
    await db
      .from('entity_suggest_jobs')
      .update({ status: giveUp ? 'failed' : 'pending', attempts, error: message.slice(0, 500) })
      .eq('id', job.id)
    result.failed++
    result.errors.push({ jobId: job.id, error: message })
  }
}

async function claimAndProcessOne(db: SupabaseClient, result: RunResult): Promise<boolean> {
  const { data: job } = await db
    .from('entity_suggest_jobs')
    .select('id, page_id, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!job) return false

  const { data: claimed } = await db
    .from('entity_suggest_jobs')
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

export async function drainEntitySuggestJobs(
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

  const { count } = await db.from('entity_suggest_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  return { ...totals, remaining: (count ?? 0) > 0 }
}
