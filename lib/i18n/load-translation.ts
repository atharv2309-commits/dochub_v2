import { SOURCE_LOCALE } from './config'

export type TranslationState = 'source' | 'translated' | 'untranslated' | 'outdated'

interface SourcePage {
  title: string
  description: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
}

interface Translation {
  title: string | null
  description: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
  status: 'machine' | 'reviewed' | 'outdated'
}

// Merge a page's source content with its translation row (if any), falling
// back to English and flagging why via `state` so the UI can notice.
export function localizePage(page: SourcePage, tr: Translation | null, lang: string) {
  if (lang === SOURCE_LOCALE || !tr) {
    return {
      title: page.title,
      description: page.description,
      content: page.content,
      state: (lang === SOURCE_LOCALE ? 'source' : 'untranslated') as TranslationState,
    }
  }
  return {
    title: tr.title ?? page.title,
    description: tr.description ?? page.description,
    content: tr.content ?? page.content,
    state: (tr.status === 'outdated' ? 'outdated' : 'translated') as TranslationState,
  }
}
