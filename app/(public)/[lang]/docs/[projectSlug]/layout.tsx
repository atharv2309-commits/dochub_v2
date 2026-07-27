import { notFound } from 'next/navigation'
import { DocsShell } from '@/components/docs/DocsShell'
import type { Project, PageWithChildren } from '@/types/db'
import type { SearchPage } from '@/components/docs/DocsSearch'
import { extractText } from '@/lib/utils/extract-text'
import { isLocale } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/dictionary'
import { DictionaryProvider } from '@/components/i18n/DictionaryProvider'
import { getPublicProject, getPublicPages, getPublicTitles } from '@/lib/docs/cache'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

// Override page titles in a tree with their localized versions (tree nodes are
// fresh copies from buildTree, so this never mutates the cached source pages).
function localizeTitles(nodes: PageWithChildren[], titles: Record<string, string>) {
  for (const n of nodes) {
    if (titles[n.id]) n.title = titles[n.id]
    if (n.children?.length) localizeTitles(n.children, titles)
  }
}

function buildTree(pages: PageWithChildren[], parentId: string | null = null): PageWithChildren[] {
  return pages
    .filter((p) => p.parent_id === parentId && !p.hidden)
    .sort((a, b) => a.order_index - b.order_index)
    .map((p) => ({ ...p, children: buildTree(pages, p.id) }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string }>
}) {
  const { projectSlug } = await params
  const project = await getPublicProject(projectSlug)
  if (!project) return {}
  return {
    title: `${project.name} Docs`,
    description: project.description,
  }
}

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string; projectSlug: string }>
}) {
  const { lang, projectSlug } = await params
  if (!isLocale(lang)) notFound()

  // Dictionary + project + full page tree resolve in parallel; the project and
  // pages come from the cached cookieless layer (shared across pages/locales).
  const [dict, project] = await Promise.all([getDictionary(lang), getPublicProject(projectSlug)])
  if (!project) notFound()

  const pagesFlat = await getPublicPages(project.id)
  const pageTree = buildTree(pagesFlat as PageWithChildren[])

  // Localize the sidebar tree page names (and search result titles) for non-
  // source locales, so the entire nav is in the user's language.
  const titles = lang === SOURCE_LOCALE ? {} : await getPublicTitles(project.id, lang)
  if (lang !== SOURCE_LOCALE) localizeTitles(pageTree, titles)

  // Build search index from published, non-hidden document pages
  const searchPages: SearchPage[] = (pagesFlat ?? [])
    .filter((p) => !p.hidden && p.kind === 'document')
    .map((p) => ({
      title: titles[p.id] ?? p.title,
      path: p.path,
      description: p.description,
      text: extractText(p.content),
    }))

  return (
    <DictionaryProvider dict={dict}>
      {/* Public components only read slug/name/icon/enabled_locales from project. */}
      <DocsShell lang={lang} project={project as unknown as Project} pageTree={pageTree} searchPages={searchPages}>
        {children}
      </DocsShell>
    </DictionaryProvider>
  )
}
