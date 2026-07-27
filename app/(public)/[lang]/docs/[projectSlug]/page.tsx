import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

interface TreePage {
  id: string
  parent_id: string | null
  path: string
  kind: string
  order_index: number
}

// Find the first document page in depth-first reading order. order_index is only
// meaningful within a parent's siblings, so we must walk the tree, not sort flat.
function firstDocument(pages: TreePage[], parentId: string | null): TreePage | null {
  const siblings = pages
    .filter((p) => p.parent_id === parentId)
    .sort((a, b) => a.order_index - b.order_index)
  for (const node of siblings) {
    if (node.kind === 'document') return node
    const childDoc = firstDocument(pages, node.id)
    if (childDoc) return childDoc
  }
  return null
}

export default async function DocsIndexPage({
  params,
}: {
  params: Promise<{ lang: string; projectSlug: string }>
}) {
  const { lang, projectSlug } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, slug')
    .eq('slug', projectSlug)
    .eq('visibility', 'public')
    .single()

  if (!project) notFound()

  const { data: pages } = await supabase
    .from('pages')
    .select('id, parent_id, path, kind, order_index')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .eq('hidden', false)

  const firstPage = firstDocument((pages ?? []) as TreePage[], null)

  if (firstPage) {
    redirect(`/${lang}/docs/${projectSlug}/${firstPage.path}`)
  }

  return (
    <div className="flex items-center justify-center py-24 text-center">
      <div>
        <h1 className="text-2xl font-bold mb-2">No pages published yet</h1>
        <p className="text-muted-foreground">Check back later.</p>
      </div>
    </div>
  )
}
