import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BlockRenderer } from '@/components/docs/BlockRenderer'
import { descendantsOf, localizeForPrint, type PrintPageRow } from '@/lib/pdf/print-helpers'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

export const dynamic = 'force-dynamic'

type PrintItem =
  | { type: 'divider'; partNumber: number; title: string; description: string | null }
  | { type: 'page'; page: PrintPageRow }

// Whole-project reading order: each top-level module (a 'group' node, e.g.
// "Device Management") becomes a numbered Part divider followed by all of its
// pages; a top-level page with no group is printed directly. Mirrors the
// sidebar's own structure so the PDF's table of contents matches the site nav.
function buildWholeProjectItems(all: PrintPageRow[]): PrintItem[] {
  const items: PrintItem[] = []
  const topLevel = all.filter((p) => p.parent_id === null).sort((a, b) => a.order_index - b.order_index)
  let partNumber = 0
  for (const node of topLevel) {
    if (node.kind === 'document') {
      items.push({ type: 'page', page: node })
      for (const child of descendantsOf(all, node.id)) items.push({ type: 'page', page: child })
    } else if (node.kind === 'group') {
      partNumber += 1
      items.push({ type: 'divider', partNumber, title: node.title, description: node.description })
      for (const child of descendantsOf(all, node.id)) items.push({ type: 'page', page: child })
    }
    // 'link' nodes have no content of their own — nothing to print.
  }
  return items
}

export default async function WholeProjectPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { projectSlug } = await params
  const { lang } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug, description')
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
  if (all.length === 0) notFound()

  const effectiveLang = lang || SOURCE_LOCALE
  const items = buildWholeProjectItems(all)
  const localizedItems = await Promise.all(
    items.map(async (item) => (item.type === 'page' ? { type: 'page' as const, page: await localizeForPrint(item.page, effectiveLang) } : item))
  )

  const date = new Date().toLocaleDateString(effectiveLang, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="light bg-white text-black" style={{ fontFamily: 'var(--font-docs)' }} dir={effectiveLang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Cover */}
      <section className="pdf-cover flex flex-col justify-center min-h-screen px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-16 h-16 mb-8" />
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500 mb-3">Complete Documentation</p>
        <h1 className="text-5xl font-bold leading-tight mb-4">{project.name}</h1>
        {project.description && <p className="text-lg text-neutral-600 max-w-2xl">{project.description}</p>}
        <div className="mt-auto pt-16 text-sm text-neutral-500">
          <p>FlytBase Documentation</p>
          <p>Generated {date}</p>
        </div>
      </section>

      {/* Body */}
      {localizedItems.map((item, i) =>
        item.type === 'divider' ? (
          <section key={`part-${i}`} className="pdf-cover flex flex-col justify-center min-h-screen px-16">
            <p className="text-sm uppercase tracking-[0.2em] text-neutral-500 mb-3">Part {item.partNumber}</p>
            <h1 className="text-4xl font-bold leading-tight mb-4">{item.title}</h1>
            {item.description && <p className="text-lg text-neutral-600 max-w-2xl">{item.description}</p>}
          </section>
        ) : (
          <section key={item.page.id} className="pdf-section px-16 py-10">
            <h1 className="text-3xl font-bold mb-6">{item.page.title}</h1>
            <div className="docs-content prose-flytbase">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <BlockRenderer blocks={(item.page.content as any[]) ?? []} print />
            </div>
          </section>
        )
      )}
    </div>
  )
}
