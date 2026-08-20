import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { GenerateNowButton } from '@/components/admin/analytics/GenerateNowButton'
import { BarChart3, Lightbulb, TrendingDown, TrendingUp, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react'

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

// Summary shape written by /api/analytics/generate-insights (matches its zod
// schema; the DB column itself is just `jsonb`, so we trust the shape here).
interface InsightsSummary {
  contentGaps: string[]
  deadEndPages: string[]
  risingTopics: string[]
  highlights: string[]
}

const SECTIONS: { key: keyof InsightsSummary; label: string; icon: typeof Lightbulb }[] = [
  { key: 'contentGaps', label: 'Content gaps', icon: Lightbulb },
  { key: 'deadEndPages', label: 'Dead-end pages', icon: TrendingDown },
  { key: 'risingTopics', label: 'Rising topics', icon: TrendingUp },
  { key: 'highlights', label: 'Highlights', icon: Sparkles },
]

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const projectList = projects ?? []
  const ids = projectList.map((p) => p.id)

  interface InsightsRow {
    project_id: string
    period_start: string
    period_end: string
    summary: unknown
    created_at: string
  }

  const { data: insights } = ids.length
    ? await supabase
        .from('analytics_insights')
        .select('project_id, period_start, period_end, summary, created_at')
        .in('project_id', ids)
        .order('created_at', { ascending: false })
    : { data: [] as InsightsRow[] }

  // Latest row per project (already ordered newest-first).
  const latestByProject = new Map<string, InsightsRow>()
  for (const row of (insights ?? []) as InsightsRow[]) {
    if (!latestByProject.has(row.project_id)) latestByProject.set(row.project_id, row)
  }

  // Raw feedback — the digest above is an AI *summary* of this; admins still
  // need to read what people actually typed, verbatim, not just Gemini's take.
  interface FeedbackRow {
    id: string
    project_id: string
    page_id: string | null
    locale: string | null
    helpful: boolean | null
    comment: string | null
    created_at: string
  }
  const { data: feedback } = ids.length
    ? await supabase
        .from('page_events')
        .select('id, project_id, page_id, locale, helpful, comment, created_at')
        .in('project_id', ids)
        .eq('event_type', 'feedback')
        .order('created_at', { ascending: false })
        .limit(300)
    : { data: [] as FeedbackRow[] }

  const feedbackPageIds = [...new Set((feedback ?? []).map((f) => f.page_id).filter((id): id is string => !!id))]
  const { data: feedbackPages } = feedbackPageIds.length
    ? await supabase.from('pages').select('id, title, path, project_id').in('id', feedbackPageIds)
    : { data: [] as { id: string; title: string; path: string; project_id: string }[] }
  const pageById = new Map((feedbackPages ?? []).map((p) => [p.id, p]))

  const feedbackByProject = new Map<string, FeedbackRow[]>()
  for (const f of (feedback ?? []) as FeedbackRow[]) {
    if (!feedbackByProject.has(f.project_id)) feedbackByProject.set(f.project_id, [])
    feedbackByProject.get(f.project_id)!.push(f)
  }

  return (
    <>
      <AdminHeader email={user.email ?? ''} />
      <main className="max-w-5xl mx-auto px-5 py-8">
        <div className="flex items-center gap-2.5 mb-1">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-8">
          Weekly digests synthesized from search queries, feedback, and download activity —
          what&apos;s missing, what&apos;s not working, and what&apos;s trending.
        </p>

        {projectList.length === 0 ? (
          <p className="text-muted-foreground">No projects yet.</p>
        ) : (
          <div className="space-y-5">
            {projectList.map((proj) => {
              const latest = latestByProject.get(proj.id)
              const summary = latest?.summary as InsightsSummary | undefined
              return (
                <div key={proj.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="font-semibold">{proj.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {latest
                          ? `Last generated ${new Date(latest.created_at).toLocaleString()}`
                          : 'No digest yet'}
                      </p>
                    </div>
                    <GenerateNowButton projectId={proj.id} />
                  </div>

                  {!summary ? (
                    <p className="text-xs text-muted-foreground">
                      No digest yet — click &quot;Generate now&quot; once this project has some traffic.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {SECTIONS.map(({ key, label, icon: Icon }) => {
                        const items = summary[key] ?? []
                        return (
                          <div key={key} className="rounded-lg bg-secondary/30 p-3.5">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Icon className="w-3.5 h-3.5 text-primary" />
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {label}
                              </p>
                            </div>
                            {items.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Nothing notable this week.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {items.map((item, i) => (
                                  <li key={i} className="text-sm leading-snug">
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {(() => {
                    const rows = feedbackByProject.get(proj.id) ?? []
                    return (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Recent feedback {rows.length > 0 && `(${rows.length})`}
                        </p>
                        {rows.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No feedback submitted yet.</p>
                        ) : (
                          <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {rows.map((f) => {
                              const page = f.page_id ? pageById.get(f.page_id) : undefined
                              return (
                                <li key={f.id} className="flex items-start gap-2.5 text-sm">
                                  {f.helpful ? (
                                    <ThumbsUp className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                                  ) : (
                                    <ThumbsDown className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {page ? (
                                        <Link
                                          href={`/${f.locale ?? 'en'}/docs/${proj.slug}/${page.path}`}
                                          target="_blank"
                                          className="font-medium hover:text-primary transition-colors truncate"
                                        >
                                          {page.title}
                                        </Link>
                                      ) : (
                                        <span className="text-muted-foreground">(page deleted)</span>
                                      )}
                                      {f.locale && f.locale !== 'en' && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                                          {f.locale}
                                        </span>
                                      )}
                                      <span className="text-xs text-muted-foreground shrink-0">
                                        {timeAgo(f.created_at)}
                                      </span>
                                    </div>
                                    {f.comment && (
                                      <p className="text-muted-foreground mt-0.5">&ldquo;{f.comment}&rdquo;</p>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
