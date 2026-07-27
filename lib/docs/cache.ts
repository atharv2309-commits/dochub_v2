import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'

// Cached, cookieless data layer for the PUBLIC docs. Everything here is
// RLS-readable by anon, so we use a cookieless client (no per-request cookies)
// and wrap reads in unstable_cache. This is what makes locale switching feel
// instant: the project + full page tree are identical across every locale and
// every page, so after the first render they're served from cache — a language
// switch only needs the (small) translation row, not a fresh tree fetch.
//
// Cache is tagged per project and time-revalidated; publishing revalidates via
// revalidateTag('docs:<projectId>') (wired from the publish flow when desired).

const REVALIDATE_SECONDS = 300

function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export interface PublicProject {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  cover_image_url: string | null
  enabled_locales: string[]
}

// A public project by slug (or null). Cached by slug.
export const getPublicProject = (slug: string) =>
  unstable_cache(
    async (): Promise<PublicProject | null> => {
      const { data } = await anon()
        .from('projects')
        .select('id, slug, name, description, icon, cover_image_url, enabled_locales')
        .eq('slug', slug)
        .eq('visibility', 'public')
        .maybeSingle()
      return (data as PublicProject) ?? null
    },
    ['public-project', slug],
    { tags: [`docs:project:${slug}`], revalidate: REVALIDATE_SECONDS }
  )()

export interface PublicPageRow {
  id: string
  project_id: string
  parent_id: string | null
  kind: string
  title: string
  link_title: string | null
  slug: string
  path: string
  description: string | null
  icon: string | null
  cover_image_url: string | null
  order_index: number
  hidden: boolean
  no_index: boolean
  tags: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
  link_href: string | null
  status: string
}

// All published pages for a project (full set; the layout builds tree + search,
// the page derives nav + breadcrumbs). Cached per project — the single most
// reused query across pages and locales.
export const getPublicPages = (projectId: string) =>
  unstable_cache(
    async (): Promise<PublicPageRow[]> => {
      const { data } = await anon()
        .from('pages')
        .select(
          'id, project_id, parent_id, kind, title, link_title, slug, path, description, icon, cover_image_url, order_index, hidden, no_index, tags, content, link_href, status'
        )
        .eq('project_id', projectId)
        .eq('status', 'published')
        .order('order_index', { ascending: true })
      return (data as PublicPageRow[]) ?? []
    },
    ['public-pages', projectId],
    { tags: [`docs:${projectId}`], revalidate: REVALIDATE_SECONDS }
  )()

export interface PublicTranslation {
  title: string | null
  description: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
  status: 'machine' | 'reviewed' | 'outdated'
}

// A single page's translation for a locale (or null). This is the only
// per-locale-varying read on the hot path; cached per (page, locale) so a
// repeat visit / back-and-forth language switch is served from cache.
export const getPublicTranslation = (pageId: string, locale: string) =>
  unstable_cache(
    async (): Promise<PublicTranslation | null> => {
      const { data } = await anon()
        .from('page_translations')
        .select('title, description, content, status')
        .eq('page_id', pageId)
        .eq('locale', locale)
        .maybeSingle()
      return (data as PublicTranslation) ?? null
    },
    ['public-translation', pageId, locale],
    { tags: [`docs:translation:${pageId}`], revalidate: REVALIDATE_SECONDS }
  )()

// Map of page_id -> translated title for a whole project in one locale, so the
// sidebar tree, breadcrumbs, and prev/next can show localized page names (not
// just the current page's body). One cached query per (project, locale).
export const getPublicTitles = (projectId: string, locale: string) =>
  unstable_cache(
    async (): Promise<Record<string, string>> => {
      const { data } = await anon()
        .from('page_translations')
        .select('page_id, title, status, pages!inner(project_id)')
        .eq('locale', locale)
        .eq('pages.project_id', projectId)
      const map: Record<string, string> = {}
      for (const row of (data ?? []) as { page_id: string; title: string | null; status: string }[]) {
        // Show a translated title even if slightly outdated — still better than
        // English in the nav; only skip when there's no title at all.
        if (row.title) map[row.page_id] = row.title
      }
      return map
    },
    ['public-titles', projectId, locale],
    { tags: [`docs:${projectId}`], revalidate: REVALIDATE_SECONDS }
  )()
