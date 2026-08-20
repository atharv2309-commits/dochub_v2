/**
 * Bulk-translate every project's published pages into their enabled locales.
 * Resumable and rate-limit-aware: it enqueues translation_jobs (skipping ones
 * already queued/running) then drains the queue in time-boxed batches, so an
 * interrupted run just picks back up where it left off on the next invocation.
 *
 * Run:  npx tsx scripts/translate-all.mjs                 (translate everything)
 *       npx tsx scripts/translate-all.mjs --stale-only     (skip up-to-date pages)
 *       npx tsx scripts/translate-all.mjs --project=slug   (one project only)
 *       npx tsx scripts/translate-all.mjs status           (queue counts, no work)
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { drainTranslationJobs } from '../lib/translation/run-jobs.ts'

function loadEnv() {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* ignore */
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const args = process.argv.slice(2)
const isStatus = args[0] === 'status'
const staleOnly = args.includes('--stale-only')
const projectArg = args.find((a) => a.startsWith('--project='))?.split('=')[1]

async function showStatus() {
  const { data: counts } = await sb.from('translation_jobs').select('status')
  const byStatus = { pending: 0, running: 0, done: 0, failed: 0 }
  for (const row of counts ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  console.log('translation_jobs:', byStatus)
}

// Mirrors the request_translations() RPC's selection logic, run directly with
// the service-role client so it doesn't need an authenticated user session.
async function enqueue(project) {
  const locales = project.enabled_locales ?? []
  if (!locales.length) return 0

  const { data: pages } = await sb
    .from('pages')
    .select('id')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .eq('hidden', false)
  if (!pages?.length) return 0
  const pageIds = pages.map((p) => p.id)

  const { data: active } = await sb
    .from('translation_jobs')
    .select('page_id, locale')
    .in('page_id', pageIds)
    .in('status', ['pending', 'running'])
  const activeSet = new Set((active ?? []).map((j) => `${j.page_id}:${j.locale}`))

  let toSkip = new Set()
  if (staleOnly) {
    const { data: translations } = await sb
      .from('page_translations')
      .select('page_id, locale, status')
      .in('page_id', pageIds)
      .in('locale', locales)
      .in('status', ['machine', 'reviewed'])
    toSkip = new Set((translations ?? []).map((t) => `${t.page_id}:${t.locale}`))
  }

  const rows = []
  for (const pageId of pageIds) {
    for (const locale of locales) {
      const key = `${pageId}:${locale}`
      if (activeSet.has(key) || toSkip.has(key)) continue
      rows.push({ page_id: pageId, locale })
    }
  }
  if (rows.length) await sb.from('translation_jobs').insert(rows)
  return rows.length
}

async function main() {
  if (isStatus) return showStatus()

  let query = sb.from('projects').select('id, slug, enabled_locales')
  if (projectArg) query = query.eq('slug', projectArg)
  const { data: projects } = await query
  if (!projects?.length) {
    console.log(projectArg ? `No project with slug "${projectArg}".` : 'No projects found.')
    return
  }

  let queued = 0
  for (const project of projects) {
    const n = await enqueue(project)
    queued += n
    console.log(`${project.slug}: queued ${n} job(s)`)
  }
  console.log(`Total queued: ${queued}`)

  let round = 0
  for (;;) {
    round++
    const result = await drainTranslationJobs(sb, { deadlineMs: Date.now() + 240_000 })
    console.log(`round ${round}: done=${result.done} failed=${result.failed} remaining=${result.remaining}`)
    if (result.errors.length) for (const e of result.errors) console.log(`  ! ${e.jobId}: ${e.error}`)
    if (!result.remaining) break
  }
  console.log('All translation jobs drained.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
