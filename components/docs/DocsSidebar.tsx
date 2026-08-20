'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Project, PageWithChildren } from '@/types/db'
import { ChevronRight, Link2, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { downloadPdf } from '@/lib/pdf/download'
import { trackEvent } from '@/lib/analytics/track'

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
  projectSlug,
  projectId,
  lang,
}: {
  page: PageWithChildren
  base: string // locale-aware docs root, e.g. "/fr/docs/my-project"
  depth: number
  projectSlug: string
  projectId: string
  lang: string
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
  const [downloading, setDownloading] = useState(false)

  async function downloadModule(e: React.MouseEvent) {
    e.stopPropagation()
    if (downloading) return
    setDownloading(true)
    try {
      // The module's own PDF already recursively appendixes every descendant
      // document page (same /print route the per-page download uses) — a
      // "module PDF" needs no separate rendering path, just this trigger.
      await downloadPdf(`/api/pdf/${projectSlug}/${page.path}?lang=${lang}`, page.title)
      trackEvent('pdf_download', { projectId, pageId: page.id, locale: lang })
    } catch {
      alert('Could not generate the PDF. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  // ── Group / section header (collapsible) ──
  if (page.kind === 'group') {
    return (
      <div className="mb-1">
        <div className="group/section w-full flex items-start gap-1.5 pt-4 pb-1 pr-2">
          <button
            onClick={() => setExpanded((o) => !o)}
            className="flex-1 flex items-start gap-1.5 text-left min-w-0"
            style={{ paddingLeft: `${indent}px` }}
          >
            <ChevronRight
              className={`w-3 h-3 mt-px shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground leading-snug break-words">
              {page.title}
            </span>
          </button>
          <button
            onClick={downloadModule}
            disabled={downloading}
            title={dict.pdf.downloadModule}
            aria-label={dict.pdf.downloadModule}
            className="shrink-0 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground transition-opacity disabled:opacity-60"
          >
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          </button>
        </div>
        {open &&
          page.children.map((child) => (
            <SidebarItem key={child.id} page={child} base={base} depth={depth + 1} projectSlug={projectSlug} projectId={projectId} lang={lang} />
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
            <SidebarItem key={child.id} page={child} base={base} depth={depth + 1} projectSlug={projectSlug} projectId={projectId} lang={lang} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DocsSidebar({ lang, project, pageTree }: Props) {
  const dict = useDict()
  const base = `/${lang}/docs/${project.slug}`
  const [downloadingAll, setDownloadingAll] = useState(false)

  async function downloadAll() {
    if (downloadingAll) return
    setDownloadingAll(true)
    try {
      await downloadPdf(`/api/pdf/${project.slug}?lang=${lang}`, `${project.slug}-complete`)
      trackEvent('pdf_download', { projectId: project.id, locale: lang })
    } catch {
      alert('Could not generate the PDF. Please try again.')
    } finally {
      setDownloadingAll(false)
    }
  }

  return (
    <aside className="w-72 h-full flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto py-4 px-2.5">
        {pageTree.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{dict.sidebar.noPages}</p>
        ) : (
          pageTree.map((page) => (
            <SidebarItem key={page.id} page={page} base={base} depth={0} projectSlug={project.slug} projectId={project.id} lang={lang} />
          ))
        )}
      </div>
      <div className="shrink-0 px-4 py-3 border-t border-sidebar-border space-y-2">
        <button
          onClick={downloadAll}
          disabled={downloadingAll}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          {downloadingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          {downloadingAll ? dict.pdf.preparing : dict.pdf.downloadAll}
        </button>
        <a
          href="https://flytbase.com"
          target="_blank"
          rel="noopener noreferrer"
          className="eyebrow hover:text-foreground transition-colors block"
        >
          {dict.sidebar.poweredBy} ↗
        </a>
      </div>
    </aside>
  )
}
