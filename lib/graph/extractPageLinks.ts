import type { SupabaseClient } from '@supabase/supabase-js'
import { SITE_URL, siteUrlForProject } from '@/lib/site'
import { isLocale } from '@/lib/i18n/config'

// The legacy GitBook site every page here was originally imported from (see
// app/api/admin/import-gitbook/route.ts's fetch(`https://docs.flytbase.com/...`)).
// Most existing content still has raw links back to it — GitBook is one
// space = one domain, so a bare {origin}/{path} there always means the
// flytbase-docs project, no locale/project segment involved. Recognizing
// this is what makes the graph non-empty for already-imported content, not
// just pages authored after this feature shipped.
const LEGACY_DOCS_ORIGIN = 'https://docs.flytbase.com'
const LEGACY_DOCS_SLUG = 'flytbase-docs'

// Internal hrefs are never page ids or relative paths — the only URL builder
// in the app (lib/mcp/public-tools.ts's docUrl()) produces full absolute
// URLs: {origin}/{locale}/docs/{projectSlug}/{path}. Editors paste whatever
// they copied from the address bar, so this inverts that shape (plus the
// /docs and /releases short aliases from proxy.ts — keep these two in sync
// with proxy.ts's resolveAlias if either ever changes).
function resolveInternalHref(href: string, knownOrigins: Set<string>): { projectSlug: string; path: string } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null // relative, mailto:, anchor-only, or otherwise malformed — not an internal doc link
  }

  if (url.origin === LEGACY_DOCS_ORIGIN) {
    const path = url.pathname.split('/').filter(Boolean).join('/')
    return path ? { projectSlug: LEGACY_DOCS_SLUG, path } : null
  }
  if (!knownOrigins.has(url.origin)) return null

  const parts = url.pathname.split('/').filter(Boolean)

  if (parts[0] === 'releases') {
    const path = parts.slice(1).join('/')
    return path ? { projectSlug: 'flytbase-releases', path } : null
  }
  if (parts.length >= 2 && isLocale(parts[0]) && parts[1] === 'releases') {
    const path = parts.slice(2).join('/')
    return path ? { projectSlug: 'flytbase-releases', path } : null
  }

  let i = 0
  if (isLocale(parts[i])) i++
  if (parts[i] === 'docs' && parts[i + 1]) {
    const path = parts.slice(i + 2).join('/')
    return path ? { projectSlug: parts[i + 1], path } : null
  }
  return null
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((n) => (n && typeof n === 'object' && typeof (n as { text?: unknown }).text === 'string' ? (n as { text: string }).text : ''))
    .join('')
    .trim()
}

// Walk a page's content collecting every internal link's target href + its
// visible text — same recursive shape as lib/translation/extract.ts's walk,
// just collecting links instead of translatable text segments.
function collectLinks(blocks: unknown, out: { href: string; text: string }[]): void {
  function walkInline(content: unknown) {
    if (!Array.isArray(content)) return
    for (const node of content) {
      if (!node || typeof node !== 'object') continue
      const n = node as Record<string, unknown>
      if (n.type === 'link' && typeof n.href === 'string') {
        out.push({ href: n.href, text: inlineText(n.content) || n.href })
      } else if (n.type === 'link') {
        walkInline(n.content)
      }
    }
  }
  function walkBlocks(list: unknown) {
    if (!Array.isArray(list)) return
    for (const block of list) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (Array.isArray(b.content)) {
        walkInline(b.content)
      } else if (b.content && (b.content as { type?: string }).type === 'tableContent') {
        const rows = (b.content as { rows?: unknown }).rows
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const cells = (row as { cells?: unknown }).cells
            if (Array.isArray(cells)) for (const cell of cells) walkInline((cell as { content?: unknown }).content)
          }
        }
      }
      if (Array.isArray(b.children)) walkBlocks(b.children)
    }
  }
  walkBlocks(blocks)
}

// Extract internal links from `pageId`'s published content and upsert them
// into page_links. Cross-project links (releases -> docs) are expected and
// kept as-is — page_links isn't scoped to a single project.
export async function extractPageLinks(db: SupabaseClient, pageId: string): Promise<{ linked: number }> {
  const { data: page } = await db.from('pages').select('content').eq('id', pageId).single()
  if (!page?.content) return { linked: 0 }

  const { data: projects } = await db.from('projects').select('id, slug')
  if (!projects?.length) return { linked: 0 }

  const knownOrigins = new Set<string>([new URL(SITE_URL).origin])
  for (const p of projects) knownOrigins.add(new URL(siteUrlForProject(p.slug)).origin)
  const projectIdBySlug = new Map(projects.map((p) => [p.slug, p.id]))

  const links: { href: string; text: string }[] = []
  collectLinks(page.content, links)

  const targets = new Map<string, string>() // "projectSlug/path" -> link_text (dedupe, keep first)
  for (const l of links) {
    const resolved = resolveInternalHref(l.href, knownOrigins)
    if (!resolved) continue
    const key = `${resolved.projectSlug}/${resolved.path}`
    if (!targets.has(key)) targets.set(key, l.text)
  }
  if (targets.size === 0) return { linked: 0 }

  // Resolve projectSlug/path -> page id in one batched query per distinct project.
  const byProject = new Map<string, { path: string; linkText: string }[]>()
  for (const [key, linkText] of targets) {
    const slashIdx = key.indexOf('/')
    const projectSlug = key.slice(0, slashIdx)
    const path = key.slice(slashIdx + 1)
    if (!projectIdBySlug.has(projectSlug)) continue
    if (!byProject.has(projectSlug)) byProject.set(projectSlug, [])
    byProject.get(projectSlug)!.push({ path, linkText })
  }

  const rows: { from_page_id: string; to_page_id: string; link_text: string }[] = []
  for (const [projectSlug, entries] of byProject) {
    const projectId = projectIdBySlug.get(projectSlug)!
    const { data: targetPages } = await db
      .from('pages')
      .select('id, path')
      .eq('project_id', projectId)
      .in('path', entries.map((e) => e.path))
    const pageIdByPath = new Map((targetPages ?? []).map((p) => [p.path, p.id]))
    for (const e of entries) {
      const toPageId = pageIdByPath.get(e.path)
      if (toPageId && toPageId !== pageId) rows.push({ from_page_id: pageId, to_page_id: toPageId, link_text: e.linkText })
    }
  }
  if (rows.length === 0) return { linked: 0 }

  const { error } = await db.from('page_links').upsert(rows, { onConflict: 'from_page_id,to_page_id' })
  if (error) throw new Error(error.message)
  return { linked: rows.length }
}
