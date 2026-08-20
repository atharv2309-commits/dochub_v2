import { type NextRequest, NextResponse } from 'next/server'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

// @ai-sdk/google's default export reads GOOGLE_GENERATIVE_AI_API_KEY; this repo
// keeps the key as GEMINI_API_KEY, so build the provider explicitly with it.
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })

// Shared-secret worker auth, same pattern as /api/translation/worker.
function authorized(request: NextRequest): boolean {
  const secret = process.env.ANALYTICS_WORKER_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

const insightsSchema = z.object({
  contentGaps: z
    .array(z.string())
    .describe('Topics or questions the docs seem to be missing, inferred from searches (especially zero-result ones)'),
  deadEndPages: z
    .array(z.string())
    .describe('Pages people seem to bounce from or mark unhelpful'),
  risingTopics: z
    .array(z.string())
    .describe('Search topics that show up often, suggesting rising interest'),
  highlights: z
    .array(z.string())
    .describe('Notably positive signals, e.g. pages with a high helpful rate'),
})

type Db = ReturnType<typeof createAdminClient>

function topCounts(values: (string | null)[], limit = 10): [string, number][] {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (!v) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

async function generateForProject(
  db: Db,
  projectId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ skipped: true } | { skipped: false; summary: z.infer<typeof insightsSchema> }> {
  const { data: events } = await db
    .from('page_events')
    .select('event_type, query_text, helpful, page_id, comment')
    .eq('project_id', projectId)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd)

  if (!events || events.length === 0) return { skipped: true }

  const { data: pages } = await db.from('pages').select('id, title, path').eq('project_id', projectId)
  const pageLabel = new Map((pages ?? []).map((p) => [p.id, p.title || p.path]))

  const topSearchQueries = topCounts(events.filter((e) => e.event_type === 'search_query').map((e) => e.query_text))
  const topZeroResultQueries = topCounts(
    events.filter((e) => e.event_type === 'search_zero_result').map((e) => e.query_text)
  )
  const topPdfDownloads = topCounts(events.filter((e) => e.event_type === 'pdf_download').map((e) => e.page_id)).map(
    ([id, n]) => [pageLabel.get(id) ?? id, n] as [string, number]
  )

  const feedbackByPage = new Map<string, { helpful: number; notHelpful: number; comments: string[] }>()
  for (const e of events) {
    if (e.event_type !== 'feedback') continue
    const key = e.page_id ?? 'unknown page'
    const f = feedbackByPage.get(key) ?? { helpful: 0, notHelpful: 0, comments: [] }
    if (e.helpful === true) f.helpful++
    else if (e.helpful === false) f.notHelpful++
    if (e.comment) f.comments.push(e.comment)
    feedbackByPage.set(key, f)
  }
  const feedbackSummary = [...feedbackByPage.entries()].map(([id, f]) => ({
    page: pageLabel.get(id) ?? id,
    ...f,
  }))

  const aggregated = {
    totalEvents: events.length,
    topSearchQueries,
    topZeroResultQueries,
    topPdfDownloads,
    feedbackByPage: feedbackSummary,
  }

  const { object } = await generateObject({
    model: google('gemini-2.5-flash'),
    schema: insightsSchema,
    prompt: `You are analyzing 7 days of aggregated (not raw) usage data for a documentation site. Synthesize plain-English findings a docs maintainer can act on.

${JSON.stringify(aggregated, null, 2)}

Be concise and specific. If a category has no clear signal in the data, return an empty array for it rather than inventing content.`,
  })

  return { skipped: false, summary: object }
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { projectId?: string } = {}
  try {
    body = await request.json()
  } catch {
    // No body = all projects.
  }

  const db = createAdminClient()
  const { data: projects } = body.projectId
    ? await db.from('projects').select('id, slug').eq('id', body.projectId)
    : await db.from('projects').select('id, slug')

  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)

  const results: { projectId: string; slug: string; status: 'generated' | 'skipped' }[] = []

  for (const project of projects ?? []) {
    const result = await generateForProject(db, project.id, periodStart.toISOString(), periodEnd.toISOString())
    if (result.skipped) {
      results.push({ projectId: project.id, slug: project.slug, status: 'skipped' })
      continue
    }
    await db.from('analytics_insights').insert({
      project_id: project.id,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      summary: result.summary,
    })
    results.push({ projectId: project.id, slug: project.slug, status: 'generated' })
  }

  return NextResponse.json({ results })
}

export const POST = handle
