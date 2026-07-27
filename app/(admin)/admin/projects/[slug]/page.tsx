import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/admin/StatCard'
import { ExternalLink, BookOpen, FileText, Globe, Lock, ArrowUpRight } from 'lucide-react'

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

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .eq('user_id', user.id)
    .single()

  if (!project) notFound()

  const { data: pages } = await supabase
    .from('pages')
    .select('id, title, status, updated_at')
    .eq('project_id', project.id)
    .order('updated_at', { ascending: false })

  const allPages = pages ?? []
  const count = allPages.length
  const publishedCount = allPages.filter((p) => p.status === 'published').length

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="text-4xl w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
            {project.icon ?? '📚'}
          </div>
          <div>
            <p className="eyebrow">Project</p>
            <h1 className="font-bold text-3xl tracking-tight mt-0.5">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground mt-1.5 text-sm">{project.description}</p>
            )}
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2 flex-shrink-0">
          <a href={`/docs/${project.slug}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4" />
            View docs
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Pages" value={count} icon={FileText} />
        <StatCard label="Published" value={publishedCount} icon={Globe} />
        <StatCard
          label="Visibility"
          value={project.visibility === 'public' ? 'Public' : 'Private'}
          icon={project.visibility === 'public' ? Globe : Lock}
        />
      </div>

      {count === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-border border-dashed rounded-xl brand-grid">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
            <BookOpen className="w-6 h-6 text-muted-foreground" />
          </div>
          <h2 className="font-semibold mb-1">No pages yet</h2>
          <p className="text-muted-foreground text-sm">
            Use the sidebar to create your first page
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recently updated</h2>
            {count > 8 && (
              <span className="text-xs text-muted-foreground">
                Browse all {count} pages in the sidebar
              </span>
            )}
          </div>
          <div className="card-elevated rounded-xl divide-y divide-border">
            {allPages.slice(0, 8).map((page) => (
              <Link
                key={page.id}
                href={`/admin/projects/${project.slug}/pages/${page.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors group first:rounded-t-xl last:rounded-b-xl"
              >
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{page.title || 'Untitled'}</p>
                  <p className="text-xs text-muted-foreground">Edited {timeAgo(page.updated_at)}</p>
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
