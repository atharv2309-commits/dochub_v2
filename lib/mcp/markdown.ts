// Serialize stored BlockNote document JSON (pages.content / draft_content) into
// readable Markdown for MCP read tools. This is the inverse of
// lib/import/markdownToBlocks.ts and is intentionally lossy-but-faithful: it
// covers every block type this app's editor can produce (see
// components/editor/schema.ts) — defaults plus the custom callout/embed blocks
// and xl-multi-column columnList/column — and degrades unknown blocks to their
// inline text rather than throwing.

interface InlineText {
  type: 'text'
  text: string
  styles?: Record<string, boolean>
}
interface InlineLink {
  type: 'link'
  href: string
  content?: InlineText[]
}
type Inline = InlineText | InlineLink | { type: string; [k: string]: unknown }

interface Block {
  type?: string
  props?: Record<string, unknown>
  content?: Inline[] | { type: string; rows?: { cells: Inline[][] }[] } | unknown
  children?: Block[]
  [k: string]: unknown
}

function styleText(node: InlineText): string {
  let t = node.text ?? ''
  if (!t) return ''
  const s = node.styles ?? {}
  if (s.code) t = `\`${t}\``
  if (s.bold) t = `**${t}**`
  if (s.italic) t = `*${t}*`
  if (s.strike) t = `~~${t}~~`
  return t
}

function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const node of content as Inline[]) {
    if (!node || typeof node !== 'object') continue
    if (node.type === 'text') {
      out += styleText(node as InlineText)
    } else if (node.type === 'link') {
      const link = node as InlineLink
      const label = inlineToMd(link.content) || link.href
      out += `[${label}](${link.href})`
    } else if ('text' in node && typeof (node as InlineText).text === 'string') {
      out += (node as InlineText).text
    }
  }
  return out
}

const CALLOUT_LABEL: Record<string, string> = {
  info: 'ℹ️ Info',
  warning: '⚠️ Warning',
  danger: '🛑 Danger',
  success: '✅ Success',
}

function blockToMd(block: Block, depth: number, counters: number[]): string {
  const indent = '  '.repeat(depth)
  const props = (block.props ?? {}) as Record<string, unknown>
  const inline = inlineToMd(block.content)
  const type = block.type ?? 'paragraph'

  let line = ''
  switch (type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(props.level ?? 2), 1), 6)
      line = `${'#'.repeat(level)} ${inline}`
      break
    }
    case 'bulletListItem':
      line = `${indent}- ${inline}`
      break
    case 'numberedListItem': {
      counters[depth] = (counters[depth] ?? 0) + 1
      line = `${indent}${counters[depth]}. ${inline}`
      break
    }
    case 'checkListItem':
      line = `${indent}- [${props.checked ? 'x' : ' '}] ${inline}`
      break
    case 'quote':
      line = `> ${inline}`
      break
    case 'codeBlock':
      line = `\`\`\`${(props.language as string) ?? ''}\n${inline}\n\`\`\``
      break
    case 'divider':
      line = '---'
      break
    case 'image': {
      const url = (props.url as string) ?? ''
      const alt = (props.caption as string) || (props.name as string) || 'image'
      line = url ? `![${alt}](${url})` : ''
      break
    }
    case 'embed': {
      const url = (props.url as string) ?? ''
      line = url ? `[Embedded media](${url})` : ''
      break
    }
    case 'callout': {
      const label = CALLOUT_LABEL[String(props.type)] ?? '📌 Note'
      line = `> **${label}** — ${inline}`
      break
    }
    case 'table':
      line = tableToMd(block.content)
      break
    case 'columnList':
    case 'column':
      // Layout containers — just flatten their children inline below.
      line = ''
      break
    default:
      line = inline
  }

  // Reset numbered-list counter when leaving a numbered run at this depth.
  if (type !== 'numberedListItem') counters[depth] = 0

  const isListItem =
    type === 'bulletListItem' || type === 'numberedListItem' || type === 'checkListItem'
  const childDepth = isListItem ? depth + 1 : depth
  const childMd = (block.children ?? [])
    .map((c) => blockToMd(c, childDepth, counters))
    .filter(Boolean)
    .join('\n')

  return [line, childMd].filter(Boolean).join('\n')
}

function tableToMd(content: unknown): string {
  const rows = (content as { rows?: { cells: unknown[] }[] })?.rows
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const render = (cells: unknown[]) => '| ' + cells.map((c) => inlineToMd(c).trim() || ' ').join(' | ') + ' |'
  const lines = [render(rows[0].cells)]
  lines.push('| ' + rows[0].cells.map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) lines.push(render(rows[i].cells))
  return lines.join('\n')
}

/** Convert a BlockNote document (array of blocks) to a Markdown string. */
export function blocksToMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const counters: number[] = []
  return (content as Block[])
    .map((b) => blockToMd(b, 0, counters))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}
