import { createClient } from '@/lib/supabase/server'
import { extractText } from '@/lib/utils/extract-text'

export interface RetrievedPage {
  title: string
  path: string
  description: string | null
  text: string
}

const MAX_PAGES = 6 // how many pages to feed the model
const MAX_CHARS_PER_PAGE = 4000 // bound per-page context so prompts stay small

// Shape returned by the search_pages RPC (see migrations/..._ai_search_fts.sql).
interface SearchPageRow {
  title: string
  path: string
  description: string | null
  content: unknown
}

/**
 * Retrieve the pages most relevant to a query for a given project.
 *
 * Uses Postgres full-text search (the `search_pages` RPC) over a GENERATED
 * tsvector column. Only the top matches are returned from the database — we
 * never load the whole corpus into the server. The tsvector is maintained
 * synchronously by Postgres on every write, so results always reflect the
 * latest published content with no embedding index, cron job, or drift.
 *
 * The signature is intentionally narrow (query in, ranked pages out) so this
 * can later be swapped for / combined with pgvector semantic search without
 * touching callers.
 */
export async function retrieveRelevantPages(
  projectSlug: string,
  query: string
): Promise<RetrievedPage[]> {
  const q = query.trim()
  if (!q) return []

  const supabase = await createClient()

  // search_pages isn't in the generated Database types yet; cast the client
  // narrowly so we keep a typed result without leaking `any`. Call rpc() as a
  // method (not a detached function) so its `this` binding is preserved.
  // Regenerate types (supabase gen types) to drop this cast.
  const sb = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: SearchPageRow[] | null; error: unknown }>
  }

  const { data, error } = await sb.rpc('search_pages', {
    p_project_slug: projectSlug,
    p_query: q,
    p_limit: MAX_PAGES,
  })

  if (error || !data) return []

  return data.map((p) => ({
    title: p.title,
    path: p.path,
    description: p.description,
    text: extractText(p.content).slice(0, MAX_CHARS_PER_PAGE),
  }))
}
