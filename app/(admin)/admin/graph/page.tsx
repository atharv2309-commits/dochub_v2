import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { GraphExplorer } from '@/components/admin/graph/GraphExplorer'
import { summarizePageContent } from '@/lib/graph/pageSummary'
import type { GraphPageNode, GraphEntityNode, GraphEdge } from '@/components/admin/graph/types'

export default async function ContentGraphPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [{ data: projects }, { data: pages }, { data: entities }, { data: pageLinks }, { data: entityLinks }] =
    await Promise.all([
      supabase.from('projects').select('id, slug, name'),
      supabase.from('pages').select('id, title, path, project_id, content').eq('kind', 'document'),
      supabase.from('content_entities').select('*'),
      supabase.from('page_links').select('*'),
      supabase.from('page_entity_links').select('*'),
    ])

  const projectSlugById = new Map((projects ?? []).map((p) => [p.id, p.slug]))
  const entityLinksByPage = new Map<string, typeof entityLinks>()
  for (const l of entityLinks ?? []) {
    if (!entityLinksByPage.has(l.page_id)) entityLinksByPage.set(l.page_id, [])
    entityLinksByPage.get(l.page_id)!.push(l)
  }
  const entityById = new Map((entities ?? []).map((e) => [e.id, e]))

  function needsAttention(link: NonNullable<typeof entityLinks>[number]): boolean {
    if (link.status !== 'ok') return true
    const entity = entityById.get(link.entity_id)
    if (entity?.changed_at && new Date(entity.changed_at) > new Date(link.reviewed_at)) return true
    return false
  }

  const pageNodes: GraphPageNode[] = (pages ?? []).map((p) => {
    const { excerpt, thumbnailUrl } = summarizePageContent(p.content)
    const links = entityLinksByPage.get(p.id) ?? []
    const status: GraphPageNode['status'] = links.length === 0 ? 'none' : links.some(needsAttention) ? 'attention' : 'ok'
    return {
      kind: 'page',
      id: p.id,
      title: p.title,
      path: p.path,
      projectSlug: projectSlugById.get(p.project_id) ?? '',
      excerpt,
      thumbnailUrl,
      status,
    }
  })

  const entityNodes: GraphEntityNode[] = (entities ?? []).map((e) => ({
    kind: 'entity',
    id: e.id,
    projectId: e.project_id,
    name: e.name,
    description: e.description,
    referenceImageUrl: e.reference_image_url,
    versionTag: e.version_tag,
    changedAt: e.changed_at,
    changeNote: e.change_note,
  }))

  const edges: GraphEdge[] = [
    ...(pageLinks ?? []).map((l) => ({
      source: l.from_page_id,
      target: l.to_page_id,
      kind: 'page-link' as const,
      linkText: l.link_text,
    })),
    ...(entityLinks ?? []).map((l) => ({
      source: l.page_id,
      target: l.entity_id,
      kind: 'entity-link' as const,
      entityLinkId: l.id,
      entityLinkKind: l.kind,
      entityLinkStatus: l.status,
      entityLinkSource: l.source,
      note: l.note,
      reviewedAt: l.reviewed_at,
      needsAttention: needsAttention(l),
    })),
  ]

  return (
    <>
      <AdminHeader email={user.email ?? ''} />
      <GraphExplorer
        projects={(projects ?? []).map((p) => ({ id: p.id, slug: p.slug, name: p.name }))}
        pageNodes={pageNodes}
        entityNodes={entityNodes}
        edges={edges}
      />
    </>
  )
}
