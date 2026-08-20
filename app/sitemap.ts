import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { currentSiteUrl, projectSlugForHost } from '@/lib/site'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

// Cookieless anon client — sitemap only needs public (RLS-readable) data.
function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = anonClient()

  // Domain-scoped deployments only advertise their own project's pages — a
  // combined sitemap across every project in the shared DB would be wrong SEO
  // for a site living at its own domain. Unmapped hosts (local/dev, a preview
  // deployment) keep the old "every public project" behavior.
  const host = (await headers()).get('host')
  const pinnedSlug = host ? projectSlugForHost(host) : null

  let query = supabase.from('projects').select('id, slug, updated_at, enabled_locales').eq('visibility', 'public')
  if (pinnedSlug) query = query.eq('slug', pinnedSlug)
  const { data: projects } = await query

  const entries: MetadataRoute.Sitemap = []
  if (!projects?.length) return entries

  const siteUrl = await currentSiteUrl()
  const bySlug = new Map(projects.map((p) => [p.id, p.slug]))
  // Locales to emit per project: source language + enabled targets.
  const localesByProject = new Map(
    projects.map((p) => [p.id, [SOURCE_LOCALE, ...((p.enabled_locales as string[] | null) ?? [])]])
  )

  // Build per-locale URLs plus hreflang alternates so search engines serve the
  // right language variant.
  const emit = (slug: string, locales: string[], suffix: string, lastModified: string, priority?: number) => {
    const languages: Record<string, string> = {}
    for (const l of locales) languages[l] = `${siteUrl}/${l}/docs/${slug}${suffix}`
    languages['x-default'] = `${siteUrl}/${SOURCE_LOCALE}/docs/${slug}${suffix}`
    for (const l of locales) {
      entries.push({
        url: `${siteUrl}/${l}/docs/${slug}${suffix}`,
        lastModified,
        changeFrequency: 'weekly',
        priority,
        alternates: { languages },
      })
    }
  }

  for (const p of projects) {
    emit(p.slug, localesByProject.get(p.id)!, '', p.updated_at)
  }

  const { data: pages } = await supabase
    .from('pages')
    .select('project_id, path, updated_at')
    .in('project_id', projects.map((p) => p.id))
    .eq('status', 'published')
    .eq('hidden', false)
    .eq('kind', 'document')

  for (const page of pages ?? []) {
    const slug = bySlug.get(page.project_id)
    if (!slug) continue
    emit(slug, localesByProject.get(page.project_id)!, `/${page.path}`, page.updated_at, 0.7)
  }

  return entries
}
