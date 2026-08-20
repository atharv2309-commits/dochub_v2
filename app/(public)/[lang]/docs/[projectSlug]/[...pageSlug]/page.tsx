import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPublicProject, getPublicPages, getPublicTranslation, getPublicTitles } from '@/lib/docs/cache'
import { BlockRenderer } from '@/components/docs/BlockRenderer'
import { TableOfContents } from '@/components/docs/TableOfContents'
import { PageNavigation } from '@/components/docs/PageNavigation'
import { PageActionsMenu } from '@/components/docs/PageActionsMenu'
import { PageFeedback } from '@/components/docs/PageFeedback'
import { TranslationNotice } from '@/components/docs/TranslationNotice'
import { ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import { siteUrlForProject } from '@/lib/site'
import { LOCALES, SOURCE_LOCALE } from '@/lib/i18n/config'
import { localizePage } from '@/lib/i18n/load-translation'
import { getDictionary } from '@/lib/i18n/dictionary'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; projectSlug: string; pageSlug: string[] }>
}): Promise<Metadata> {
  const { lang, projectSlug, pageSlug } = await params
  const path = pageSlug.join('/')

  const project = await getPublicProject(projectSlug)
  if (!project) return {}

  const pages = await getPublicPages(project.id)
  const sourcePage = pages.find((p) => p.path === path)
  if (!sourcePage) return {}

  // Prefer the translated title/description for the locale's metadata (SEO).
  const tr = lang === SOURCE_LOCALE ? null : await getPublicTranslation(sourcePage.id, lang)
  const page = {
    title: tr?.title ?? sourcePage.title,
    description: tr?.description ?? sourcePage.description,
    cover_image_url: sourcePage.cover_image_url,
    no_index: sourcePage.no_index,
  }

  const siteUrl = siteUrlForProject(projectSlug)
  const title = `${page.title} — ${project.name}`
  const url = `${siteUrl}/${lang}/docs/${projectSlug}/${path}`
  const images = page.cover_image_url ? [{ url: page.cover_image_url }] : undefined

  // hreflang: tell search engines about every locale variant of this page, plus
  // an x-default pointing at the source language.
  const languages: Record<string, string> = {}
  for (const l of LOCALES) {
    languages[l.code] = `${siteUrl}/${l.code}/docs/${projectSlug}/${path}`
  }
  languages['x-default'] = `${siteUrl}/${SOURCE_LOCALE}/docs/${projectSlug}/${path}`

  return {
    title,
    description: page.description ?? undefined,
    alternates: { canonical: url, languages },
    robots: page.no_index ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'article',
      title,
      description: page.description ?? undefined,
      url,
      siteName: `${project.name} Docs`,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.description ?? undefined,
      images: page.cover_image_url ? [page.cover_image_url] : undefined,
    },
  }
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ lang: string; projectSlug: string; pageSlug: string[] }>
}) {
  const { lang, projectSlug, pageSlug } = await params
  const path = pageSlug.join('/')

  // Project + full page set come from the cached, cookieless layer (shared
  // across locales/pages) — so a language switch re-uses them and only the
  // translation row varies.
  const project = await getPublicProject(projectSlug)
  if (!project) notFound()

  const allPublished = await getPublicPages(project.id)
  const page = allPublished.find((p) => p.path === path)
  if (!page) notFound()

  // Resolve the locale's translation, UI dictionary, and localized page-name map
  // up front. The page content falls back to the English source (with a notice)
  // when a translation is missing/stale; the title map localizes the nav.
  const [tr, dict, titles] = await Promise.all([
    lang === SOURCE_LOCALE ? Promise.resolve(null) : getPublicTranslation(page.id, lang),
    getDictionary(lang),
    lang === SOURCE_LOCALE
      ? Promise.resolve({} as Record<string, string>)
      : getPublicTitles(project.id, lang),
  ])
  const localized = localizePage(page, tr, lang)
  // Localized page name for nav (breadcrumbs, prev/next) — falls back to source.
  const titleOf = (id: string, fallback: string) => titles[id] ?? fallback

  // Non-hidden pages drive prev/next + breadcrumb resolution.
  const everyPage = allPublished.filter((p) => !p.hidden)

  // Flatten the page tree into depth-first reading order for prev/next.
  // order_index is only meaningful within a parent's siblings, so we walk the
  // tree rather than sorting the flat list (which would interleave branches).
  type NavP = (typeof everyPage)[number]
  const readingOrder: NavP[] = []
  const walk = (parentId: string | null) => {
    everyPage
      .filter((p) => p.parent_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((node) => {
        if (node.kind === 'document') readingOrder.push(node)
        walk(node.id)
      })
  }
  walk(null)

  const currentIndex = readingOrder.findIndex((p) => p.id === page.id)
  // Localized copies (don't mutate the cached page objects).
  const localizeNav = (p: (typeof readingOrder)[number] | null) =>
    p ? { ...p, title: titleOf(p.id, p.title) } : null
  const prevPage = localizeNav(currentIndex > 0 ? readingOrder[currentIndex - 1] : null)
  const nextPage = localizeNav(
    currentIndex >= 0 && currentIndex < readingOrder.length - 1 ? readingOrder[currentIndex + 1] : null
  )

  // Build breadcrumb trail by walking the parent chain
  const byId = new Map(everyPage.map((p) => [p.id, p]))
  const trail: { id: string; title: string; path: string; kind: string }[] = []
  let cursor = page.parent_id
  while (cursor) {
    const parent = byId.get(cursor)
    if (!parent) break
    trail.unshift(parent)
    cursor = parent.parent_id
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (localized.content as any[]) ?? []

  return (
    <div className="flex gap-10 max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
      {/* Main content */}
      <article className="flex-1 min-w-0 max-w-3xl pb-24">
        {/* Cover image */}
        {page.cover_image_url && (
          <div className="mb-8 rounded-xl overflow-hidden h-48 w-full border border-border">
            <img
              src={page.cover_image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Breadcrumb + actions */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            <Link href={`/${lang}/docs/${projectSlug}`} className="hover:text-foreground transition-colors">
              {project.name}
            </Link>
            {trail.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1.5">
                <ChevronRight className="w-3 h-3" />
                {crumb.kind === 'document' ? (
                  <Link
                    href={`/${lang}/docs/${projectSlug}/${crumb.path}`}
                    className="hover:text-foreground transition-colors"
                  >
                    {titleOf(crumb.id, crumb.title)}
                  </Link>
                ) : (
                  <span>{titleOf(crumb.id, crumb.title)}</span>
                )}
              </span>
            ))}
          </nav>
          <PageActionsMenu projectSlug={projectSlug} projectId={project.id} pageId={page.id} path={path} lang={lang} />
        </div>

        {/* Translation status notice (only when not an up-to-date translation) */}
        <TranslationNotice state={localized.state} labels={dict.translation} />

        {/* Page icon + title */}
        <header className="mb-8">
          {page.icon && <div className="text-4xl mb-3">{page.icon}</div>}
          <h1 className="text-4xl font-bold tracking-tight mb-3 leading-tight">{localized.title}</h1>
          {localized.description && (
            <p className="text-muted-foreground text-lg leading-relaxed">{localized.description}</p>
          )}
          {page.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {page.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* Content */}
        <div className="docs-content prose-flytbase">
          <BlockRenderer blocks={content} emptyLabel={dict.content.empty} />
        </div>

        {/* Feedback */}
        <PageFeedback projectId={project.id} pageId={page.id} locale={lang} />

        {/* Prev/Next navigation */}
        <PageNavigation
          prevPage={prevPage}
          nextPage={nextPage}
          projectSlug={projectSlug}
          lang={lang}
          labels={{ previous: dict.nav.previous, next: dict.nav.next }}
        />
      </article>

      {/* Table of contents */}
      {content.length > 0 && (
        <aside className="w-52 flex-shrink-0 hidden xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
            <TableOfContents blocks={content} />
          </div>
        </aside>
      )}
    </div>
  )
}
