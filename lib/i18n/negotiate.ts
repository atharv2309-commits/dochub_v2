import { DEFAULT_LOCALE, isLocale } from './config'

export function localeFromPathname(pathname: string): string | null {
  const seg = pathname.split('/')[1]
  return seg && isLocale(seg) ? seg : null
}

// Accept-Language is a comma-separated list of tags with optional ";q=" weights
// (default weight 1), highest weight first per RFC 9110 §12.5.4.
function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';q=')
      return { tag: tag.trim(), q: qPart ? parseFloat(qPart) : 1 }
    })
    .filter((x) => x.tag && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag)
}

// Resolution order: saved cookie preference, then the browser's Accept-Language
// (by primary subtag, e.g. "fr-CA" -> "fr"), then the source language.
export function resolveLocale(opts: {
  pathname: string
  cookieLocale?: string
  acceptLanguage?: string | null
}): string {
  if (opts.cookieLocale && isLocale(opts.cookieLocale)) return opts.cookieLocale

  for (const tag of parseAcceptLanguage(opts.acceptLanguage ?? null)) {
    const primary = tag.split('-')[0].toLowerCase()
    if (isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}
