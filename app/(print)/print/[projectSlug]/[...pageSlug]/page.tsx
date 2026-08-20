import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BlockRenderer } from '@/components/docs/BlockRenderer'
import { descendantsOf, localizeForPrint, APPENDIX_LABELS, type PrintPageRow } from '@/lib/pdf/print-helpers'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

export const dynamic = 'force-dynamic'

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; pageSlug: string[] }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { projectSlug, pageSlug } = await params
  const { lang } = await searchParams
  const path = pageSlug.join('/')
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug')
    .eq('slug', projectSlug)
    .eq('visibility', 'public')
    .single()
  if (!project) notFound()

  const { data: pages } = await supabase
    .from('pages')
    .select('id, parent_id, title, path, description, kind, order_index, content')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .eq('hidden', false)

  const all = (pages ?? []) as PrintPageRow[]
  const page = all.find((p) => p.path === path)
  if (!page) notFound()

  const appendices = descendantsOf(all, page.id)

  // Localize every page in this document (main + appendices) for the requested
  // locale, same fallback-to-English-with-no-404 behavior as the live site.
  const effectiveLang = lang || SOURCE_LOCALE
  const localizedPage = await localizeForPrint(page, effectiveLang)
  const localizedAppendices = await Promise.all(appendices.map((child) => localizeForPrint(child, effectiveLang)))

  const date = new Date().toLocaleDateString(effectiveLang, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="light bg-white text-black" style={{ fontFamily: 'var(--font-docs)' }} dir={effectiveLang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Cover */}
      <section className="pdf-cover flex flex-col justify-center min-h-screen px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-16 h-16 mb-8" />
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500 mb-3">{project.name}</p>
        <h1 className="text-5xl font-bold leading-tight mb-4">{localizedPage.title}</h1>
        {localizedPage.description && <p className="text-lg text-neutral-600 max-w-2xl">{localizedPage.description}</p>}
        <div className="mt-auto pt-16 text-sm text-neutral-500">
          <p>FlytBase Documentation</p>
          <p>Generated {date}</p>
        </div>
      </section>

      {/* Main content */}
      <section className="pdf-section px-16 py-10">
        <h1 className="text-3xl font-bold mb-6">{localizedPage.title}</h1>
        <div className="docs-content prose-flytbase">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <BlockRenderer blocks={(localizedPage.content as any[]) ?? []} print />
        </div>
      </section>

      {/* Appendices — nested pages */}
      {localizedAppendices.map((child, i) => (
        <section key={child.id} className="pdf-section px-16 py-10">
          <p className="text-sm uppercase tracking-[0.15em] text-neutral-500 mb-1">
            Appendix {APPENDIX_LABELS[i] ?? i + 1}
          </p>
          <h1 className="text-3xl font-bold mb-6">{child.title}</h1>
          <div className="docs-content prose-flytbase">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <BlockRenderer blocks={(child.content as any[]) ?? []} print />
          </div>
        </section>
      ))}
    </div>
  )
}
