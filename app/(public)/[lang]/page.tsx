import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isLocale } from '@/lib/i18n/config'

// Locale home (e.g. /en, /fr). Entry point for the public docs — redirects to
// the first public project's docs in the active locale. proxy.ts routes a
// locale-less "/" here after prefixing the resolved locale.
export default async function LocaleHome({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const supabase = await createClient()

  // A deployment fronting one specific site pins its home project — either by
  // domain (proxy.ts sets x-project-slug from DOMAIN_PROJECT_MAP) or, for a
  // preview deployment with no domain mapping yet, DEFAULT_PROJECT_SLUG.
  const pinnedSlug = (await headers()).get('x-project-slug') || process.env.DEFAULT_PROJECT_SLUG
  if (pinnedSlug) {
    const { data: pinned } = await supabase
      .from('projects')
      .select('slug')
      .eq('slug', pinnedSlug)
      .eq('visibility', 'public')
      .maybeSingle()
    if (pinned) redirect(`/${lang}/docs/${pinned.slug}`)
  }

  const { data: project } = await supabase
    .from('projects')
    .select('slug')
    .eq('visibility', 'public')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (project) redirect(`/${lang}/docs/${project.slug}`)
  notFound()
}
