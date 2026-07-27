import { codeToHtml } from 'shiki'

// Server-side syntax highlighting (Shiki). Runs in RSC only — never shipped to
// the client. Lazily loads grammars; falls back to plain text for unknown langs.
export async function highlightCode(code: string, lang: string): Promise<string> {
  const language = (lang || 'text').toLowerCase()
  try {
    return await codeToHtml(code, { lang: language, theme: 'github-dark', colorReplacements: { '#24292e': 'transparent' } })
  } catch {
    return await codeToHtml(code, { lang: 'text', theme: 'github-dark', colorReplacements: { '#24292e': 'transparent' } })
  }
}
