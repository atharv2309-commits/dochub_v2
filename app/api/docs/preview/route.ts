import { type NextRequest, NextResponse } from 'next/server'
import { getPublicProject, getPublicPages, getPublicTranslation } from '@/lib/docs/cache'
import { resolveInternalLink, knownOriginsFor } from '@/lib/docs/resolveInternalLink'
import { extractPageIntro } from '@/lib/graph/pageSummary'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

// Same two projects proxy.ts's resolveAlias() and extractPageLinks.ts already
// hardcode — knownOriginsFor() just needs their slugs, not a DB round trip.
const PROJECT_SLUGS = ['flytbase-docs', 'flytbase-releases']

// Backs the internal-link hover-preview card: given the raw href a link in
// page content points to, resolve it (if internal) and return just enough to
// render a preview — title, excerpt, thumbnail. External/unresolvable hrefs
// get a 404 so the client falls back to a plain link, no preview.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const href = url.searchParams.get('href')
  const lang = url.searchParams.get('lang') || SOURCE_LOCALE
  if (!href) return NextResponse.json({ error: 'missing href' }, { status: 400 })

  const resolved = resolveInternalLink(href, knownOriginsFor(PROJECT_SLUGS))
  if (!resolved) return NextResponse.json({ error: 'not internal' }, { status: 404 })

  const project = await getPublicProject(resolved.projectSlug)
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const pages = await getPublicPages(project.id)
  const page = pages.find((p) => p.path === resolved.path && !p.hidden)
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const tr = lang === SOURCE_LOCALE ? null : await getPublicTranslation(page.id, lang)
  const title = tr?.title || page.title
  const description = tr?.description ?? page.description
  const content = tr?.content ?? page.content
  const paragraphs = extractPageIntro(content)
  if (paragraphs.length === 0 && description) paragraphs.push(description)

  return NextResponse.json(
    { title, paragraphs, projectSlug: resolved.projectSlug, path: resolved.path },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
