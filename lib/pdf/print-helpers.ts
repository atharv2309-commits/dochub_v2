import { getPublicTranslation } from '@/lib/docs/cache'
import { localizePage } from '@/lib/i18n/load-translation'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

export interface PrintPageRow {
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
// Shared by the single-page print route (appendices) and the whole-project
// route (every module's pages) so the two stay structurally identical.
export function descendantsOf<T extends PrintPageRow>(all: T[], rootId: string): T[] {
  const out: T[] = []
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

export const APPENDIX_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Resolve a page's title/description/content for the requested print locale,
// falling back to the English source exactly like the live reading pages
// (via the same getPublicTranslation + localizePage helpers) — so a PDF in a
// language with no translation yet still renders instead of erroring.
export async function localizeForPrint<T extends PrintPageRow>(page: T, lang: string): Promise<T> {
  if (lang === SOURCE_LOCALE) return page
  const tr = await getPublicTranslation(page.id, lang)
  return { ...page, ...localizePage(page, tr, lang) }
}
