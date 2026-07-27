import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { ProjectLanguageGrid, type LangStat } from '@/components/admin/translations/ProjectLanguageGrid'
import { Languages, ChevronRight } from 'lucide-react'

// Translation overview: every project shows ALL languages. Click a language to
// translate it — by default only the pages that need it (missing or out of
// date). No per-project language selection step.
export default async function TranslationsOverview() {
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

  // Published page counts per project (the translation denominator).
  const { data: pages } = ids.length
    ? await supabase
        .from('pages')
        .select('id, project_id')
        .in('project_id', ids)
        .eq('status', 'published')
        .eq('hidden', false)
    : { data: [] as { id: string; project_id: string }[] }

  const pageIds = (pages ?? []).map((p) => p.id)
  const { data: translations } = pageIds.length
    ? await supabase
        .from('page_translations')
        .select('page_id, locale, status')
        .in('page_id', pageIds)
    : { data: [] as { page_id: string; locale: string; status: string }[] }

  const totalByProject = new Map<string, number>()
  for (const pg of pages ?? [])
    totalByProject.set(pg.project_id, (totalByProject.get(pg.project_id) ?? 0) + 1)

  const pageToProject = new Map((pages ?? []).map((p) => [p.id, p.project_id]))
  // project -> locale -> { translated (machine+reviewed), outdated }
  const statsByProject = new Map<string, Record<string, LangStat>>()
  for (const t of translations ?? []) {
    const proj = pageToProject.get(t.page_id)
    if (!proj) continue
    if (!statsByProject.has(proj)) statsByProject.set(proj, {})
    const m = statsByProject.get(proj)!
    const s = (m[t.locale] ??= { translated: 0, outdated: 0, missing: 0 })
    if (t.status === 'outdated') s.outdated++
    else s.translated++
  }
  // Fill in `missing` per locale = total - (translated + outdated).
  for (const [proj, m] of statsByProject) {
    const total = totalByProject.get(proj) ?? 0
    for (const s of Object.values(m)) s.missing = Math.max(0, total - s.translated - s.outdated)
  }

  return (
    <>
      <AdminHeader email={user.email ?? ''} />
      <main className="max-w-5xl mx-auto px-5 py-8">
        <div className="flex items-center gap-2.5 mb-1">
          <Languages className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Translations</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-8">
          Click a language to translate a project into it. Translating targets only
          the pages that need it (new or out of date); published changes keep their
          translations in sync automatically.
        </p>

        {projectList.length === 0 ? (
          <p className="text-muted-foreground">No projects yet.</p>
        ) : (
          <div className="space-y-5">
            {projectList.map((proj) => {
              const total = totalByProject.get(proj.id) ?? 0
              return (
                <div key={proj.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <Link
                        href={`/admin/translations/${proj.slug}`}
                        className="group flex items-center gap-1.5 font-semibold hover:text-primary transition-colors"
                      >
                        {proj.name}
                        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {total} published {total === 1 ? 'page' : 'pages'}
                      </p>
                    </div>
                  </div>

                  {total === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No published pages yet — nothing to translate.
                    </p>
                  ) : (
                    <ProjectLanguageGrid
                      projectId={proj.id}
                      totalPages={total}
                      stats={statsByProject.get(proj.id) ?? {}}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
