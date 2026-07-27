import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BlockRenderer } from '@/components/docs/BlockRenderer'

export const dynamic = 'force-dynamic'

interface PageRow {
  id: string
  parent_id: string | null
  title: string
  path: string
  description: string | null
  kind: string
  order_index: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
}

// Descendant document pages of `rootId`, in depth-first reading order.
function descendantsOf(all: PageRow[], rootId: string): PageRow[] {
  const out: PageRow[] = []
  const walk = (parentId: string) => {
    all
      .filter((p) => p.parent_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((node) => {
        if (node.kind === 'document') out.push(node)
        walk(node.id)
      })
  }
  walk(rootId)
  return out
}

const APPENDIX_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default async function PrintPage({
  params,
}: {
  params: Promise<{ projectSlug: string; pageSlug: string[] }>
}) {
  const { projectSlug, pageSlug } = await params
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

  const all = (pages ?? []) as PageRow[]
  const page = all.find((p) => p.path === path)
  if (!page) notFound()

  const appendices = descendantsOf(all, page.id)
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="light bg-white text-black" style={{ fontFamily: 'var(--font-docs)' }}>
      {/* Cover */}
      <section className="pdf-cover flex flex-col justify-center min-h-screen px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-16 h-16 mb-8" />
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500 mb-3">{project.name}</p>
        <h1 className="text-5xl font-bold leading-tight mb-4">{page.title}</h1>
        {page.description && <p className="text-lg text-neutral-600 max-w-2xl">{page.description}</p>}
        <div className="mt-auto pt-16 text-sm text-neutral-500">
          <p>FlytBase Documentation</p>
          <p>Generated {date}</p>
        </div>
      </section>

      {/* Main content */}
      <section className="pdf-section px-16 py-10">
        <h1 className="text-3xl font-bold mb-6">{page.title}</h1>
        <div className="docs-content prose-flytbase">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <BlockRenderer blocks={(page.content as any[]) ?? []} print />
        </div>
      </section>

      {/* Appendices — nested pages */}
      {appendices.map((child, i) => (
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
