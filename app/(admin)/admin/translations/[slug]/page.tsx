import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { TranslationMatrix } from '@/components/admin/translations/TranslationMatrix'
import { ArrowLeft } from 'lucide-react'

export default async function ProjectTranslations({
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
    .select('id, name, slug, enabled_locales')
    .eq('slug', slug)
    .eq('user_id', user.id)
    .single()
  if (!project) notFound()

  const { data: pages } = await supabase
    .from('pages')
    .select('id, title, path, order_index, parent_id, kind')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .eq('hidden', false)
    .order('order_index', { ascending: true })

  // Document pages only, in reading order, are translation targets.
  const all = pages ?? []
  const reading: typeof all = []
  const walk = (parentId: string | null) => {
    all
      .filter((p) => p.parent_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((n) => {
        if (n.kind === 'document') reading.push(n)
        walk(n.id)
      })
  }
  walk(null)

  const pageIds = reading.map((p) => p.id)
  const { data: translations } = pageIds.length
    ? await supabase
        .from('page_translations')
        .select('page_id, locale, status, engine, translated_at')
        .in('page_id', pageIds)
    : { data: [] }

  const { data: jobs } = pageIds.length
    ? await supabase
        .from('translation_jobs')
        .select('id, page_id, locale, status, attempts, error, updated_at')
        .in('page_id', pageIds)
        .order('updated_at', { ascending: false })
        .limit(40)
    : { data: [] }

  return (
    <>
      <AdminHeader email={user.email ?? ''} />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <Link
          href="/admin/translations"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> All projects
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mb-1">{project.name}</h1>
        <p className="text-muted-foreground text-sm mb-6">Translation status by page and language.</p>

        <TranslationMatrix
          projectId={project.id}
          enabledLocales={project.enabled_locales ?? []}
          pages={reading.map((p) => ({ id: p.id, title: p.title, path: p.path }))}
          translations={translations ?? []}
          jobs={jobs ?? []}
        />
      </main>
    </>
  )
}
