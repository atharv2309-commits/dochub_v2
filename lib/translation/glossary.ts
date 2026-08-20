// Do-not-translate glossary: swaps configured terms (e.g. "Operations
// Dashboard") for placeholders before a batch hits the translation engine,
// then restores the original term after — so the reader always sees the
// exact product UI label, in every language, regardless of which engine is
// active. Placeholder format verified empirically to survive google-free
// (Google's web endpoint) untouched; plain bracket/number tokens like this
// are the standard trick because MT engines treat them as opaque markup.
const PLACEHOLDER = (i: number) => `[[G${i}]]`
const PLACEHOLDER_RE = /\[\[G(\d+)\]\]/g

// Longest-first so a multi-word term (e.g. "Operations Dashboard Pro") is
// matched whole rather than a shorter contained term stealing the match first.
function sortedByLengthDesc(terms: string[]): string[] {
  return [...terms].sort((a, b) => b.length - a.length)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface GlossaryProtection {
  texts: string[]
  restore(translated: string[]): string[]
}

// Protect every glossary term occurrence (case-insensitive, whole-word) across
// a batch of texts. Each text gets its own placeholder index space isn't
// needed — indices are global across the whole batch, restore just does a
// global regex replace per string, so it's safe either way.
export function protectGlossaryTerms(texts: string[], terms: string[]): GlossaryProtection {
  if (terms.length === 0) return { texts, restore: (t) => t }

  const ordered = sortedByLengthDesc(terms)
  const pattern = new RegExp(`\\b(${ordered.map(escapeRegExp).join('|')})\\b`, 'gi')
  const originalByPlaceholder = new Map<string, string>()
  let counter = 0

  const protectedTexts = texts.map((text) =>
    text.replace(pattern, (match) => {
      const token = PLACEHOLDER(counter++)
      originalByPlaceholder.set(token, match)
      return token
    })
  )

  return {
    texts: protectedTexts,
    restore: (translated) =>
      translated.map((text) =>
        text.replace(PLACEHOLDER_RE, (token) => originalByPlaceholder.get(token) ?? token)
      ),
  }
}
