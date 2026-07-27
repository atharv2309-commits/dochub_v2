import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CreateProjectDialog } from '@/components/admin/CreateProjectDialog'
import { ProjectCard } from '@/components/admin/ProjectCard'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { StatCard } from '@/components/admin/StatCard'
import { BookOpen, FileText, FolderKanban, Globe, FileEdit, ArrowUpRight } from 'lucide-react'

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

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map((p) => p.id)

  // Pull pages for stats + recent activity (only the columns we need)
  const { data: pages } = projectIds.length
    ? await supabase
        .from('pages')
        .select('id, project_id, title, path, status, updated_at, draft_updated_at')
        .in('project_id', projectIds)
    : { data: [] as { id: string; project_id: string; title: string; path: string; status: string; updated_at: string; draft_updated_at: string | null }[] }

  const allPages = pages ?? []
  const totalPages = allPages.length
  const publishedPages = allPages.filter((p) => p.status === 'published').length
  // Pending review: never-published, or published with saved draft edits
  const pendingPages = allPages.filter(
    (p) => p.status === 'draft' || p.draft_updated_at != null
  ).length

  // Page counts per project
  const pageCounts = new Map<string, { total: number; published: number }>()
  for (const p of allPages) {
    const c = pageCounts.get(p.project_id) ?? { total: 0, published: 0 }
    c.total++
    if (p.status === 'published') c.published++
    pageCounts.set(p.project_id, c)
  }

  const projectName = new Map((projects ?? []).map((p) => [p.id, { name: p.name, slug: p.slug, icon: p.icon }]))

  const recentPages = [...allPages]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader email={user.email ?? ''} />

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Heading */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="font-bold text-4xl mt-1.5 tracking-tight">Documentation Hub</h1>
            <p className="text-muted-foreground text-sm mt-2">
              Manage your organization&apos;s documentation spaces
            </p>
          </div>
          <CreateProjectDialog userId={user.id} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatCard label="Projects" value={projects?.length ?? 0} icon={FolderKanban} />
          <StatCard label="Total Pages" value={totalPages} icon={FileText} />
          <StatCard label="Published" value={publishedPages} icon={Globe} />
          <Link href="/admin/drafts" className="block">
            <StatCard label="Pending Review" value={pendingPages} icon={FileEdit} hint="Drafts & changes →" />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Projects */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Projects</h2>
              <span className="eyebrow">{projects?.length ?? 0} total</span>
            </div>

            {projects && projects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    stats={pageCounts.get(project.id) ?? { total: 0, published: 0 }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center border border-border border-dashed rounded-xl brand-grid">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4">
                  <BookOpen className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
                <p className="text-muted-foreground text-sm mb-6 max-w-xs">
                  Create your first documentation project to get started
                </p>
                <CreateProjectDialog userId={user.id} />
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Recent activity</h2>
            </div>
            <div className="card-elevated rounded-xl divide-y divide-border">
              {recentPages.length > 0 ? (
                recentPages.map((page) => {
                  const proj = projectName.get(page.project_id)
                  return (
                    <Link
                      key={page.id}
                      href={`/admin/projects/${proj?.slug}/pages/${page.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors group first:rounded-t-xl last:rounded-b-xl"
                    >
                      <span className="text-base shrink-0">{proj?.icon ?? '📄'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate group-hover:text-foreground">
                          {page.title || 'Untitled'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {proj?.name} · {timeAgo(page.updated_at)}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                          page.status === 'published'
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {page.status === 'published' ? 'Live' : 'Draft'}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors shrink-0" />
                    </Link>
                  )
                })
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No activity yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
