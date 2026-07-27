import { redirect, notFound } from 'next/navigation'
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
