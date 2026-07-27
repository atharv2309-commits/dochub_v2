'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Project, PageWithChildren } from '@/types/db'
import { ChevronRight, Link2 } from 'lucide-react'
import { useState } from 'react'
import { useDict } from '@/components/i18n/DictionaryProvider'

interface Props {
  lang: string
  project: Project
  pageTree: PageWithChildren[]
}

function hasActiveDescendant(page: PageWithChildren, base: string, pathname: string): boolean {
  for (const child of page.children) {
    if (pathname === `${base}/${child.path}`) return true
    if (hasActiveDescendant(child, base, pathname)) return true
  }
  return false
}

function SidebarItem({
  page,
  base,
  depth,
}: {
  page: PageWithChildren
  base: string // locale-aware docs root, e.g. "/fr/docs/my-project"
  depth: number
}) {
  const pathname = usePathname()
  const dict = useDict()
  const href = `${base}/${page.path}`
  const isActive = pathname === href
  const hasChildren = page.children.length > 0
  const activeInside = hasChildren && hasActiveDescendant(page, base, pathname)

  // Sections (and pages with children) start expanded, or open when a child is active.
  const [expanded, setExpanded] = useState(true)
  const open = expanded || activeInside
  const indent = 12 + depth * 12

  // ── Group / section header (collapsible) ──
  if (page.kind === 'group') {
    return (
      <div className="mb-1">
        <button
          onClick={() => setExpanded((o) => !o)}
          className="w-full flex items-start gap-1.5 pt-4 pb-1 pr-2 text-left"
          style={{ paddingLeft: `${indent}px` }}
        >
          <ChevronRight
            className={`w-3 h-3 mt-px shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground leading-snug break-words">
            {page.title}
          </span>
        </button>
        {open &&
          page.children.map((child) => (
            <SidebarItem key={child.id} page={child} base={base} depth={depth + 1} />
          ))}
      </div>
    )
  }

  // ── External link ──
  if (page.kind === 'link') {
    return (
      <a
        href={page.link_href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2 py-1.5 pr-2 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors"
        style={{ paddingLeft: `${indent}px` }}
      >
        <Link2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span className="leading-snug break-words">{page.title}</span>
      </a>
    )
  }

  // ── Document page ──
  return (
    <div>
      <div
        className={`flex items-start gap-1.5 rounded-md transition-colors ${
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded((o) => !o)}
            className="w-5 h-6 flex items-center justify-center text-muted-foreground flex-shrink-0"
            aria-label={open ? dict.sidebar.collapse : dict.sidebar.expand}
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}

        <Link href={href} className="flex items-start gap-2 flex-1 min-w-0 py-1.5 pr-2 text-sm">
          {page.icon ? <span className="text-sm mt-px">{page.icon}</span> : null}
          <span className="leading-snug break-words">{page.title}</span>
        </Link>
      </div>

      {hasChildren && open && (
        <div>
          {page.children.map((child) => (
            <SidebarItem key={child.id} page={child} base={base} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DocsSidebar({ lang, project, pageTree }: Props) {
  const dict = useDict()
  const base = `/${lang}/docs/${project.slug}`
  return (
    <aside className="w-72 h-full flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto py-4 px-2.5">
        {pageTree.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{dict.sidebar.noPages}</p>
        ) : (
          pageTree.map((page) => (
            <SidebarItem key={page.id} page={page} base={base} depth={0} />
          ))
        )}
      </div>
      <div className="shrink-0 px-4 py-3 border-t border-sidebar-border">
        <a
          href="https://flytbase.com"
          target="_blank"
          rel="noopener noreferrer"
          className="eyebrow hover:text-foreground transition-colors"
        >
          {dict.sidebar.poweredBy} ↗
        </a>
      </div>
    </aside>
  )
}
