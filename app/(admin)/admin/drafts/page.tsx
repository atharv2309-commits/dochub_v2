import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { PublishDraftButton } from '@/components/admin/PublishDraftButton'
import { FileEdit, Clock, FilePlus2, ArrowUpRight } from 'lucide-react'

function timeAgo(date: string | null): string {
  if (!date) return ''
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

export default async function DraftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug, icon')
    .eq('user_id', user.id)

  const projectMap = new Map((projects ?? []).map((p) => [p.id, p]))
  const projectIds = (projects ?? []).map((p) => p.id)

  // Pending = never-published (status=draft) OR has saved draft edits
  const { data: drafts } = projectIds.length
    ? await supabase
        .from('pages')
        .select('id, project_id, title, draft_title, path, status, draft_updated_at, updated_at')
        .in('project_id', projectIds)
        .or('status.eq.draft,draft_updated_at.not.is.null')
        .order('draft_updated_at', { ascending: false, nullsFirst: false })
    : { data: [] as never[] }

  const items = drafts ?? []

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader email={user.email ?? ''} />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="eyebrow">Review queue</p>
          <h1 className="font-bold text-4xl mt-1.5 tracking-tight">Drafts</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Unpublished pages and pending changes. Review and publish to make them live.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-border border-dashed rounded-xl brand-grid">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4">
              <FileEdit className="w-6 h-6 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-1">Nothing to review</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              All your pages are published with no pending changes.
            </p>
          </div>
        ) : (
          <div className="card-elevated rounded-xl divide-y divide-border">
            {items.map((page) => {
              const proj = projectMap.get(page.project_id)
              const isNew = page.status === 'draft' && !page.draft_updated_at
              const pendingEdit = page.status === 'published'
              return (
                <div key={page.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      pendingEdit ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {pendingEdit ? <FileEdit className="w-4 h-4" /> : isNew ? <FilePlus2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  </span>

                  <Link
                    href={`/admin/projects/${proj?.slug}/pages/${page.id}`}
                    className="min-w-0 flex-1 group"
                  >
                    <p className="text-sm truncate group-hover:text-foreground flex items-center gap-1.5">
                      {page.draft_title ?? page.title}
                      <ArrowUpRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {proj?.icon} {proj?.name}
                      {' · '}
                      {pendingEdit
                        ? `edited ${timeAgo(page.draft_updated_at)}`
                        : isNew
                        ? 'new page'
                        : `draft · ${timeAgo(page.draft_updated_at ?? page.updated_at)}`}
                    </p>
                  </Link>

                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      pendingEdit
                        ? 'bg-primary/10 text-primary'
                        : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {pendingEdit ? 'Pending changes' : 'Unpublished'}
                  </span>

                  <PublishDraftButton pageId={page.id} />
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
