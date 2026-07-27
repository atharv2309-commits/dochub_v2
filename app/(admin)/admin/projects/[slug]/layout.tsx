import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectSidebar } from '@/components/admin/ProjectSidebar'
import type { PageWithChildren } from '@/types/db'

function buildTree(pages: PageWithChildren[], parentId: string | null = null): PageWithChildren[] {
  return pages
    .filter((p) => p.parent_id === parentId)
    .sort((a, b) => a.order_index - b.order_index)
    .map((p) => ({ ...p, children: buildTree(pages, p.id) }))
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
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

  const { data: pagesFlat } = await supabase
    .from('pages')
    .select('*')
    .eq('project_id', project.id)
    .order('order_index', { ascending: true })

  const pageTree = buildTree((pagesFlat ?? []) as PageWithChildren[])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ProjectSidebar project={project} pageTree={pageTree} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
