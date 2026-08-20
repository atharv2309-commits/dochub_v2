// Cheap, server-side-only preview for the graph's side panel: first
// paragraph's text and first image's URL. Not a general-purpose renderer —
// just enough to make a node click show something real instead of a label.

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((n) => (n && typeof n === 'object' && typeof (n as { text?: unknown }).text === 'string' ? (n as { text: string }).text : ''))
    .join('')
}

export function summarizePageContent(content: unknown): { excerpt: string; thumbnailUrl: string | null } {
  let excerpt = ''
  let thumbnailUrl: string | null = null

  function walk(blocks: unknown) {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (excerpt && thumbnailUrl) return
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (!excerpt && b.type === 'paragraph' && Array.isArray(b.content)) {
        const text = inlineText(b.content).trim()
        if (text) excerpt = text.length > 220 ? text.slice(0, 220) + '…' : text
      }
      if (!thumbnailUrl && b.type === 'image') {
        const url = (b.props as { url?: unknown } | undefined)?.url
        if (typeof url === 'string' && url) thumbnailUrl = url
      }
      if (Array.isArray(b.children)) walk(b.children)
    }
  }
  walk(content)

  return { excerpt, thumbnailUrl }
}

// Richer intro for the link hover-preview card: several real paragraphs
// (plus headings/list items for structure) up to a character budget, not
// just one truncated sentence — the card is scrollable, so it can afford to
// show enough that a reader gets an actual answer, not just a teaser.
export function extractPageIntro(content: unknown, maxChars = 900): string[] {
  const parts: string[] = []
  let total = 0

  function walk(blocks: unknown) {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (total >= maxChars) return
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      const type = b.type as string

      if ((type === 'paragraph' || type === 'heading' || type === 'bulletListItem' || type === 'numberedListItem') && Array.isArray(b.content)) {
        const text = inlineText(b.content).trim()
        if (text) {
          parts.push(type === 'bulletListItem' || type === 'numberedListItem' ? `• ${text}` : text)
          total += text.length
        }
      }
      if (Array.isArray(b.children)) walk(b.children)
    }
  }
  walk(content)

  return parts
}

// Every image URL on a page, capped — feeds the AI stale/gap audit. A page
// with a dozen screenshots shouldn't balloon one Gemini call, so this caps
// rather than returning everything.
export function extractPageImages(content: unknown, max = 5): string[] {
  const urls: string[] = []

  function walk(blocks: unknown) {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (urls.length >= max) return
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'image') {
        const url = (b.props as { url?: unknown } | undefined)?.url
        if (typeof url === 'string' && url) urls.push(url)
      }
      if (Array.isArray(b.children)) walk(b.children)
    }
  }
  walk(content)

  return urls
}
