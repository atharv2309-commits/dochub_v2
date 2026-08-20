import en from './dictionaries/en.json'
import { SOURCE_LOCALE } from './config'

export type Dictionary = typeof en

const cache = new Map<string, Dictionary>()

// Fill any key a locale's dictionary hasn't translated yet with the English
// original, so a partial `translate:ui` run never renders as `undefined`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withFallback(source: any, translated: any): any {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const t = translated?.[key]
    out[key] = typeof value === 'string' ? (typeof t === 'string' ? t : value) : withFallback(value, t)
  }
  return out
}

export async function getDictionary(locale: string): Promise<Dictionary> {
  if (locale === SOURCE_LOCALE) return en
  const cached = cache.get(locale)
  if (cached) return cached
  try {
    const mod = await import(`./dictionaries/${locale}.json`)
    const dict = withFallback(en, mod.default) as Dictionary
    cache.set(locale, dict)
    return dict
  } catch {
    return en
  }
}
