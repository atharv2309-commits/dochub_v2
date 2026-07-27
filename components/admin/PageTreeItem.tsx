'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PageWithChildren } from '@/types/db'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronRight,
  FileText,
  FolderMinus,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Link2,
  GripVertical,
} from 'lucide-react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  page: PageWithChildren
  projectSlug: string
  projectId: string
  depth: number
  onCreateChild: (parentId: string, siblings: PageWithChildren[]) => void
}

export function PageTreeItem({ page, projectSlug, projectId, depth, onCreateChild }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [expanded, setExpanded] = useState(true)
  const [hovering, setHovering] = useState(false)
  const supabase = createClient()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const isActive = pathname === `/admin/projects/${projectSlug}/pages/${page.id}`
  const hasChildren = page.children.length > 0
  const indentPx = depth * 12

  async function handleDelete() {
    if (!confirm(`Delete "${page.title}"? This will also delete all subpages.`)) return
    await supabase.from('pages').delete().eq('id', page.id)
    router.push(`/admin/projects/${projectSlug}`)
    router.refresh()
  }

  async function handleToggleHidden() {
    await supabase.from('pages').update({ hidden: !page.hidden }).eq('id', page.id)
    router.refresh()
  }

  const PageIcon = page.kind === 'link' ? Link2 : page.kind === 'group' ? FolderMinus : FileText

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`group flex items-start gap-1 rounded-md px-2 py-1 transition-colors ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'
        } ${page.hidden ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${4 + indentPx}px` }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className={`w-3.5 h-5 flex items-center justify-center flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground ${
            hovering ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-3 h-3" />
        </button>

        {/* Expand toggle */}
        <button
          onClick={(e) => { e.preventDefault(); setExpanded(!expanded) }}
          className={`w-4 h-5 flex items-center justify-center flex-shrink-0 text-muted-foreground ${
            hasChildren ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>

        {/* Page icon + title */}
        <Link
          href={`/admin/projects/${projectSlug}/pages/${page.id}`}
          className="flex items-start gap-1.5 flex-1 min-w-0 py-0.5"
        >
          {page.icon ? (
            <span className="text-sm flex-shrink-0">{page.icon}</span>
          ) : (
            <PageIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs leading-snug break-words">{page.title}</span>
        </Link>

        {/* Actions (visible on hover) */}
        <div className={`flex items-center gap-0.5 flex-shrink-0 ${hovering || isActive ? 'opacity-100' : 'opacity-0'}`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onCreateChild(page.id, page.children) }}
            title="Add subpage"
          >
            <Plus className="w-3 h-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link href={`/admin/projects/${projectSlug}/pages/${page.id}`}>
                  <Pencil className="w-3.5 h-3.5 mr-2" />
                  Edit page
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleHidden}>
                {page.hidden ? (
                  <><Eye className="w-3.5 h-3.5 mr-2" />Show page</>
                ) : (
                  <><EyeOff className="w-3.5 h-3.5 mr-2" />Hide page</>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Children — their own sortable context (reorder within siblings) */}
      {hasChildren && expanded && (
        <SortableContext items={page.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {page.children.map((child) => (
            <PageTreeItem
              key={child.id}
              page={child}
              projectSlug={projectSlug}
              projectId={projectId}
              depth={depth + 1}
              onCreateChild={onCreateChild}
            />
          ))}
        </SortableContext>
      )}
    </div>
  )
}
