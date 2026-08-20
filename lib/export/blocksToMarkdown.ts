// Convert BlockNote block JSON back into clean Markdown text — the reverse of
// lib/import/markdownToBlocks.ts. Mirrors the block vocabulary BlockRenderer.tsx
// actually renders (see that file for the authoritative list). Not full
// round-trip fidelity — just readable, correct markdown for LLM consumption /
// "Copy page" / "View as Markdown".

type TextStyle = { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean; underline?: boolean }
type StyledText = { type: 'text'; text: string; styles?: TextStyle }
type LinkContent = { type: 'link'; href: string; content: InlineNode[] }
type InlineNode = StyledText | LinkContent
type TableContent = { type: 'tableContent'; rows: { cells: { content: InlineNode[] }[] }[] }
type BlockContent = InlineNode[] | TableContent

interface DocBlock {
  id: string
  type: string
  props: Record<string, unknown>
  content?: BlockContent
  children?: DocBlock[]
}

function renderInline(nodes: InlineNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'link') return `[${renderInline(n.content)}](${n.href})`
      let t = n.text
      // Note: `underline` has no plain-markdown equivalent — text is kept, the
      // style itself is dropped (not content loss, just emphasis loss).
      if (n.styles?.code) return '`' + t + '`'
      if (n.styles?.bold) t = `**${t}**`
      if (n.styles?.italic) t = `*${t}*`
      if (n.styles?.strikethrough) t = `~~${t}~~`
      return t
    })
    .join('')
}

function plainText(nodes: InlineNode[] = []): string {
  return nodes.map((n) => (n.type === 'link' ? plainText(n.content) : n.text)).join('')
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => (l ? prefix + l : l))
    .join('\n')
}

// Render a flat block list, tracking ordered-list numbering per consecutive
// run (resets whenever the run breaks) — same grouping BlockRenderer does.
function renderBlocks(blocks: DocBlock[]): string {
  const out: string[] = []
  let olIndex = 1
  for (const block of blocks) {
    if (block.type === 'numberedListItem') {
      out.push(renderBlock(block, olIndex))
      olIndex++
    } else {
      olIndex = 1
      const rendered = renderBlock(block, 1)
      if (rendered !== null) out.push(rendered)
    }
  }
  return out.join('\n\n')
}

function renderBlock(block: DocBlock, olIndex: number): string {
  const inline = Array.isArray(block.content) ? (block.content as InlineNode[]) : []

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max((block.props.level as number) ?? 1, 1), 6)
      return `${'#'.repeat(level)} ${renderInline(inline)}`
    }

    case 'paragraph':
      return renderInline(inline)

    case 'bulletListItem': {
      const kids = block.children?.length ? '\n' + indent(renderBlocks(block.children), '  ') : ''
      return `- ${renderInline(inline)}${kids}`
    }

    case 'numberedListItem': {
      const kids = block.children?.length ? '\n' + indent(renderBlocks(block.children), '   ') : ''
      return `${olIndex}. ${renderInline(inline)}${kids}`
    }

    case 'checkListItem':
      return `- [${block.props.checked ? 'x' : ' '}] ${renderInline(inline)}`

    case 'codeBlock': {
      const langProp = block.props.language
      const lang =
        typeof langProp === 'object' && langProp
          ? ((langProp as { language: string }).language ?? '')
          : ((langProp as string) ?? '')
      const code = plainText(inline)
      return '```' + (lang && lang !== 'text' ? lang : '') + '\n' + code + '\n```'
    }

    case 'image': {
      const url = block.props.url as string | undefined
      if (!url) return ''
      return `![${(block.props.caption as string) ?? ''}](${url})`
    }

    case 'embed': {
      const url = block.props.url as string | undefined
      if (!url) return ''
      const caption = (block.props.caption as string) || url
      return `[${caption}](${url})`
    }

    case 'callout': {
      const type = ((block.props.type as string) ?? 'info').toUpperCase()
      return `> **${type}:** ${renderInline(inline)}`
    }

    case 'quote':
      return `> ${renderInline(inline)}`

    case 'divider':
      return '---'

    case 'table': {
      const table = block.content as TableContent | undefined
      const rows = table?.rows ?? []
      if (!rows.length) return ''
      const [header, ...body] = rows
      const cell = (c: { content: InlineNode[] }) => renderInline(c.content).replace(/\|/g, '\\|')
      const lines = [
        `| ${header.cells.map(cell).join(' | ')} |`,
        `| ${header.cells.map(() => '---').join(' | ')} |`,
        ...body.map((r) => `| ${r.cells.map(cell).join(' | ')} |`),
      ]
      return lines.join('\n')
    }

    // Markdown has no side-by-side layout (this needs @blocknote/xl-multi-column
    // to render) — columns are flattened into sequential sections. Content is
    // preserved; only the side-by-side layout is lost.
    case 'columnList':
      return (block.children ?? [])
        .map((col) => renderBlocks(col.children ?? []))
        .filter(Boolean)
        .join('\n\n')
    case 'column':
      return renderBlocks(block.children ?? [])

    default:
      // Unknown block type: never silently drop content — fall back to its
      // inline text (if any) rather than skipping the block outright.
      return inline.length ? renderInline(inline) : ''
  }
}

export function blocksToMarkdown(blocks: DocBlock[]): string {
  if (!blocks?.length) return ''
  return renderBlocks(blocks).trim() + '\n'
}
