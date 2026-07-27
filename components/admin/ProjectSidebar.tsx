'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Project, PageWithChildren } from '@/types/db'
import { PageTreeItem } from './PageTreeItem'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronLeft,
  Plus,
  ExternalLink,
} from 'lucide-react'
import { toSlug, generateOrderBetween } from '@/lib/utils/slug'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

interface Props {
  project: Project
  pageTree: PageWithChildren[]
}

export function ProjectSidebar({ project, pageTree }: Props) {
  const params = useParams()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const supabase = createClient()

  async function createPage(parentId: string | null = null, siblings: PageWithChildren[]) {
    setCreating(true)
    const title = 'Untitled'
    const slug = toSlug(title) + '-' + Date.now().toString(36)
    const parentPage = parentId
      ? findPage(pageTree, parentId)
      : null
    const parentPath = parentPage?.path ?? null
    const path = parentPath ? `${parentPath}/${slug}` : slug
    const lastSibling = siblings[siblings.length - 1]
    const orderIndex = generateOrderBetween(lastSibling?.order_index ?? null, null)

    const { data, error } = await supabase.from('pages').insert({
      project_id: project.id,
      parent_id: parentId,
      title,
      slug,
      path,
      order_index: orderIndex,
      kind: 'document',
      status: 'draft',
    }).select().single()

    setCreating(false)
    if (!error && data) {
      router.push(`/admin/projects/${project.slug}/pages/${data.id}`)
      router.refresh()
    }
  }

  function findPage(tree: PageWithChildren[], id: string): PageWithChildren | null {
    for (const p of tree) {
      if (p.id === id) return p
      const found = findPage(p.children, id)
      if (found) return found
    }
    return null
  }

  // The ordered sibling list (and parent id) that a given page belongs to.
  function siblingsOf(id: string): { siblings: PageWithChildren[]; parentId: string | null } | null {
    function search(nodes: PageWithChildren[], parentId: string | null): { siblings: PageWithChildren[]; parentId: string | null } | null {
      if (nodes.some((n) => n.id === id)) return { siblings: nodes, parentId }
      for (const n of nodes) {
        const r = search(n.children, n.id)
        if (r) return r
      }
      return null
    }
    return search(pageTree, null)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Reorder a page among its siblings (drag within the same parent).
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const a = siblingsOf(active.id as string)
    const o = siblingsOf(over.id as string)
    if (!a || !o || a.parentId !== o.parentId) return // same-parent reorder only

    const ids = a.siblings.map((s) => s.id)
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(a.siblings, oldIndex, newIndex)
    const pos = reordered.findIndex((s) => s.id === active.id)
    const prev = reordered[pos - 1]?.order_index ?? null
    const next = reordered[pos + 1]?.order_index ?? null
    const newOrder = generateOrderBetween(prev, next)

    await supabase.from('pages').update({ order_index: newOrder }).eq('id', active.id as string)
    router.refresh()
  }

  return (
    <aside className="w-72 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 flex items-center px-3 gap-2 border-b border-sidebar-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" asChild>
              <Link href="/admin">
                <ChevronLeft className="w-4 h-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">All projects</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-lg">{project.icon ?? '📚'}</span>
          <span className="font-semibold text-sm truncate">{project.name}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground flex-shrink-0" asChild>
              <a href={`/docs/${project.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">View published docs</TooltipContent>
        </Tooltip>
      </div>

      {/* Pages tree */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {pageTree.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <p className="text-muted-foreground text-xs">No pages yet</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pageTree.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5">
                {pageTree.map((page) => (
                  <PageTreeItem
                    key={page.id}
                    page={page}
                    projectSlug={project.slug}
                    projectId={project.id}
                    depth={0}
                    onCreateChild={(parentId, siblings) => createPage(parentId, siblings)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Add page button */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground text-xs h-8"
          onClick={() => createPage(null, pageTree)}
          disabled={creating}
        >
          <Plus className="w-3.5 h-3.5" />
          {creating ? 'Creating...' : 'New page'}
        </Button>
      </div>
    </aside>
  )
}
