import { type NextRequest, NextResponse } from 'next/server'
import { getPublicProject, getPublicPages, getPublicTranslation } from '@/lib/docs/cache'
import { SOURCE_LOCALE } from '@/lib/i18n/config'
import { localizePage } from '@/lib/i18n/load-translation'
import { blocksToMarkdown } from '@/lib/export/blocksToMarkdown'

// Raw markdown for a public page — same lookup as the public page route
// (published, project visibility: public, via the RLS-scoped anon cache
// layer). Backs "View as Markdown" (opened directly) and "Copy page"
// (fetched client-side) in PageActionsMenu.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectSlug: string; pageSlug: string[] }> }
) {
  const { projectSlug, pageSlug } = await params
  const path = pageSlug.join('/')
  const lang = new URL(request.url).searchParams.get('lang') || SOURCE_LOCALE

  const project = await getPublicProject(projectSlug)
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const pages = await getPublicPages(project.id)
  const page = pages.find((p) => p.path === path)
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const tr = lang === SOURCE_LOCALE ? null : await getPublicTranslation(page.id, lang)
  const localized = localizePage(page, tr, lang)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = blocksToMarkdown((localized.content as any[]) ?? [])
  const heading = `# ${localized.title}\n\n`
  const desc = localized.description ? `${localized.description}\n\n` : ''

  return new NextResponse(heading + desc + body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
