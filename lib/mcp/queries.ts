import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { blocksToMarkdown } from './markdown'

// Shared read helpers used by BOTH MCP servers. The PUBLIC server passes an anon
// client (RLS guarantees published/public-only); the ADMIN server passes a
// service client and may opt into unpublished content via `includeUnpublished`.
//
// The page tree is hierarchical (parent_id) with per-sibling fractional
// order_index, so reading order requires a depth-first walk sorted within each
// parent — never a flat sort of the whole list (that interleaves branches).

type SB = SupabaseClient<Database>

const PAGE_COLS =
  'id, parent_id, kind, title, slug, path, description, icon, tags, order_index, hidden, status'

export interface TreeNode {
  title: string
  path: string
  kind: string
  icon: string | null
  hidden: boolean
  status: string
  children: TreeNode[]
}

interface PageRow {
  id: string
  parent_id: string | null
  kind: string
  title: string
  slug: string
  path: string
  description: string | null
  icon: string | null
  tags: string[] | null
  order_index: number
  hidden: boolean
  status: string
}

export interface ProjectInfo {
  slug: string
  name: string
  description: string | null
  icon: string | null
  visibility: string
}

/** Resolve a project by slug. Public callers only see public projects (RLS). */
export async function getProject(
  sb: SB,
  slug: string
): Promise<{ id: string; slug: string; name: string } | null> {
  const { data } = await sb
    .from('projects')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle()
  return data ?? null
}

export async function listProjects(sb: SB): Promise<ProjectInfo[]> {
  const { data } = await sb
    .from('projects')
    .select('slug, name, description, icon, visibility')
    .order('name', { ascending: true })
  return (data as ProjectInfo[] | null) ?? []
}

export interface SearchHit {
  project_slug: string
  title: string
  path: string
  description: string | null
  snippet: string | null
  rank: number
}

/** Full-text search via the mcp_search_pages RPC (public/published only). */
export async function searchDocs(
  sb: SB,
  opts: { query: string; project?: string; tag?: string; limit?: number }
): Promise<SearchHit[]> {
  const q = opts.query.trim()
  if (!q) return []
  const rpc = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: SearchHit[] | null; error: unknown }>
  const { data, error } = await rpc('mcp_search_pages', {
    p_query: q,
    p_project_slug: opts.project ?? null,
    p_tag: opts.tag ?? null,
    p_limit: opts.limit ?? 8,
  })
  // Log server-side for observability but never surface DB internals to the caller.
  if (error) {
    console.error('[mcp] search_docs error:', error)
    return []
  }
  return data ?? []
}

/**
 * Build the page tree for a project. By default only published, non-hidden
 * document/group/link nodes (the public navigation). `includeUnpublished` (admin)
 * returns everything, including drafts and hidden pages.
 */
export async function getPageTree(
  sb: SB,
  projectId: string,
  opts: { underPath?: string; includeUnpublished?: boolean } = {}
): Promise<TreeNode[]> {
  let query = sb.from('pages').select(PAGE_COLS).eq('project_id', projectId)
  if (!opts.includeUnpublished) {
    query = query.eq('status', 'published').eq('hidden', false)
  }
  const { data } = await query.order('order_index', { ascending: true })
  const rows = (data as PageRow[] | null) ?? []

  const byParent = new Map<string | null, PageRow[]>()
  for (const r of rows) {
    const key = r.parent_id
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(r)
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((r) => ({
        title: r.title,
        path: r.path,
        kind: r.kind,
        icon: r.icon,
        hidden: r.hidden,
        status: r.status,
        children: build(r.id),
      }))

  let roots = build(null)
  if (opts.underPath) {
    const find = (nodes: TreeNode[]): TreeNode[] | null => {
      for (const n of nodes) {
        if (n.path === opts.underPath) return n.children
        const hit = find(n.children)
        if (hit) return hit
      }
      return null
    }
    roots = find(roots) ?? []
  }
  return roots
}

export interface PageDetail {
  title: string
  path: string
  description: string | null
  tags: string[]
  icon: string | null
  status: string
  markdown: string
  hasDraft: boolean
}

/**
 * Fetch one page by path and render it to Markdown.
 * `draft: true` (admin) renders draft_* content for review instead of published.
 */
export async function getPage(
  sb: SB,
  projectId: string,
  path: string,
  opts: { draft?: boolean; includeUnpublished?: boolean } = {}
): Promise<PageDetail | null> {
  // Only fetch draft_* columns when an admin/draft caller actually needs them.
  // The public (anon) path must never even select draft content — drafts are
  // unpublished and would otherwise sit in memory next to published output.
  const wantsDraft = !!opts.draft || !!opts.includeUnpublished
  const cols = wantsDraft
    ? 'title, path, description, tags, icon, status, content, draft_title, draft_description, draft_content'
    : 'title, path, description, tags, icon, status, content'

  let query = sb.from('pages').select(cols).eq('project_id', projectId).eq('path', path)
  if (!opts.includeUnpublished && !opts.draft) {
    query = query.eq('status', 'published')
  }
  const { data } = await query.maybeSingle()
  if (!data) return null

  const row = data as unknown as {
    title: string
    path: string
    description: string | null
    tags: string[] | null
    icon: string | null
    status: string
    content: unknown
    draft_title?: string | null
    draft_description?: string | null
    draft_content?: unknown
  }

  const useDraft = !!opts.draft && row.draft_content != null
  return {
    title: (useDraft ? row.draft_title : null) ?? row.title,
    path: row.path,
    description: (useDraft ? row.draft_description : null) ?? row.description,
    tags: row.tags ?? [],
    icon: row.icon,
    status: row.status,
    markdown: blocksToMarkdown(useDraft ? row.draft_content : row.content),
    hasDraft: row.draft_content != null,
  }
}
