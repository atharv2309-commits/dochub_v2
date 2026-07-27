import { createHash } from 'node:crypto'

// Block-aware extraction for BlockNote JSON. We never translate the document as
// a blob — that would mangle structure, translate code, and break links.
// Instead we collect individual translatable text *segments*, translate those,
// and splice the results back into a clone of the original tree (reassemble.ts),
// so tables/columns/images/props are preserved byte-for-byte.

export interface Segment {
  /** Stable address into the JSON tree, e.g. "3.content.1.text" or "5.props.caption". */
  path: string
  /** The source text to translate. */
  text: string
  /** Content hash of the text — the unit of translation-memory reuse. */
  hash: string
}

// Block types whose textual content must NOT be translated.
const SKIP_BLOCK_TYPES = new Set(['codeBlock'])

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function pushSegment(segments: Segment[], path: string, text: string) {
  // Only translate things with actual letters/words — skip pure punctuation,
  // numbers, and whitespace to avoid wasting engine calls.
  if (text && /\p{L}/u.test(text)) {
    segments.push({ path, text, hash: hashText(text) })
  }
}

// Walk an inline-content array (text + link nodes). Link hrefs are never
// translated; link inner text is.
function walkInline(content: unknown, basePath: string, segments: Segment[]) {
  if (!Array.isArray(content)) return
  content.forEach((node, i) => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'text' && typeof n.text === 'string') {
      pushSegment(segments, `${basePath}.${i}.text`, n.text)
    } else if (n.type === 'link') {
      // Translate the visible text inside the link, not the href.
      walkInline(n.content, `${basePath}.${i}.content`, segments)
    }
  })
}

// Walk a table's tableContent rows/cells.
function walkTable(content: unknown, basePath: string, segments: Segment[]) {
  const rows = (content as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return
  rows.forEach((row, ri) => {
    const cells = (row as { cells?: unknown }).cells
    if (!Array.isArray(cells)) return
    cells.forEach((cell, ci) => {
      walkInline(
        (cell as { content?: unknown }).content,
        `${basePath}.rows.${ri}.cells.${ci}.content`,
        segments
      )
    })
  })
}

function walkBlocks(blocks: unknown, basePath: string, segments: Segment[]) {
  if (!Array.isArray(blocks)) return
  blocks.forEach((block, i) => {
    if (!block || typeof block !== 'object') return
    const b = block as Record<string, unknown>
    const type = typeof b.type === 'string' ? b.type : ''
    const path = basePath ? `${basePath}.${i}` : `${i}`

    // Translatable caption lives in props for image/embed blocks.
    const props = b.props as Record<string, unknown> | undefined
    if (props && typeof props.caption === 'string') {
      pushSegment(segments, `${path}.props.caption`, props.caption)
    }

    if (!SKIP_BLOCK_TYPES.has(type)) {
      const content = b.content
      if (Array.isArray(content)) {
        walkInline(content, `${path}.content`, segments)
      } else if (content && (content as { type?: string }).type === 'tableContent') {
        walkTable(content, `${path}.content`, segments)
      }
    }

    if (Array.isArray(b.children)) {
      walkBlocks(b.children, `${path}.children`, segments)
    }
  })
}

// Collect every translatable segment from a BlockNote document.
export function extractSegments(content: unknown): Segment[] {
  const segments: Segment[] = []
  walkBlocks(content, '', segments)
  return segments
}
