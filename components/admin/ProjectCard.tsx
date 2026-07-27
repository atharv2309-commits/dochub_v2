'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Project } from '@/types/db'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, ExternalLink, Pencil, Trash2, FileText, Globe } from 'lucide-react'

export function ProjectCard({
  project,
  stats,
}: {
  project: Project
  stats?: { total: number; published: number }
}) {
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleDelete() {
    if (!confirm(`Delete "${project.name}"? This will permanently delete all pages.`)) return
    setDeleting(true)
    await supabase.from('projects').delete().eq('id', project.id)
    router.refresh()
  }

  return (
    <div className="group relative card-elevated rounded-xl p-5">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/admin/projects/${project.slug}`} className="flex items-center gap-3 flex-1 min-w-0">
          <div className="text-2xl flex-shrink-0 w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">{project.icon ?? '📚'}</div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug truncate">{project.name}</h3>
            {project.description && (
              <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">
                {project.description}
              </p>
            )}
          </div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/admin/projects/${project.slug}`}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit project
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/docs/${project.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                View docs
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border/60">
        <Badge variant="secondary" className="text-xs capitalize gap-1">
          {project.visibility === 'public' ? (
            <Globe className="w-3 h-3" />
          ) : null}
          {project.visibility}
        </Badge>
        {stats && (
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <FileText className="w-3 h-3" />
            {stats.total} {stats.total === 1 ? 'page' : 'pages'}
            {stats.published > 0 && (
              <span className="text-green-400/80 ml-1">· {stats.published} live</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
