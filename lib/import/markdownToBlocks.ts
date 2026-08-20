// Convert GitBook-flavored markdown into BlockNote block JSON.
// Handles: headings, paragraphs, bullet/numbered lists, blockquotes, code blocks,
// dividers, GitBook hints ({% hint %}) -> callouts, GitBook figures -> image blocks,
// GitBook embeds -> link paragraphs, and inline bold/italic/code/links.

let idCounter = 0
function blockId(): string {
  idCounter += 1
  return `imp-${Date.now().toString(36)}-${idCounter}`
}

const TEXT_PROPS = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' as const }

type Styles = Record<string, boolean>
type Inline =
  | { type: 'text'; text: string; styles: Styles }
  | { type: 'link'; href: string; content: { type: 'text'; text: string; styles: Styles }[] }

interface Block {
  id: string
  type: string
  props: Record<string, unknown>
  content: Inline[] | undefined
  children: Block[]
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x20;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
}

// Tokenize inline markdown into BlockNote inline content.
function parseInline(raw: string): Inline[] {
  const text = raw
  const out: Inline[] = []
  // Regex for links, bold, italic, inline code — processed left to right.
  const pattern = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  function pushText(t: string, styles: Styles = {}) {
    if (!t) return
    out.push({ type: 'text', text: decodeEntities(t), styles })
  }
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index))
    if (m[1]) {
      // link
      const label = m[2]
      // CommonMark's <...> destination form (needed for URLs with spaces).
      let href = m[3].trim().replace(/^<|>$/g, '')
      // GitBook internal links point to ".md" files — strip the extension.
      href = href.replace(/\.md(#.*)?$/, '$1')
      out.push({
        type: 'link',
        href,
        content: [{ type: 'text', text: decodeEntities(label), styles: {} }],
      })
    } else if (m[4]) {
      pushText(m[5], { bold: true })
    } else if (m[6]) {
      pushText(m[7], { bold: true })
    } else if (m[8]) {
      pushText(m[9], { italic: true })
    } else if (m[10]) {
      pushText(m[11], { italic: true })
    } else if (m[12]) {
      pushText(m[13], { code: true })
    }
    last = pattern.lastIndex
  }
  if (last < text.length) pushText(text.slice(last))
  return out.length ? out : [{ type: 'text', text: '', styles: {} }]
}

function makeBlock(type: string, content: Inline[] | undefined, props: Record<string, unknown> = {}): Block {
  return { id: blockId(), type, props: { ...TEXT_PROPS, ...props }, content, children: [] }
}

// Image block (BlockNote native). url may be a `gitbook-file:<ID>` placeholder
// that the import route resolves to a hosted URL before insert.
function makeImageBlock(url: string, caption: string, name = ''): Block {
  return {
    id: blockId(),
    type: 'image',
    props: {
      backgroundColor: 'default',
      textAlignment: 'left',
      name,
      url,
      caption,
      showPreview: true,
      previewWidth: 768,
    },
    content: undefined,
    children: [],
  }
}

// Custom embed block (video). Rendered as a responsive iframe.
function makeEmbedBlock(url: string, caption: string): Block {
  return {
    id: blockId(),
    type: 'embed',
    props: { url, caption },
    content: undefined,
    children: [],
  }
}

const HINT_TYPE_MAP: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
}

export interface ConvertResult {
  title: string
  description: string
  blocks: Block[]
}

// Strip a leading GitBook YAML frontmatter block (---\n...\n---) and pull out
// its `description` (the only field GitBook exports that we use), whether
// single-line or a folded block scalar (`>-`).
function stripFrontmatter(md: string): { md: string; description: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { md, description: '' }
  const body = m[1]
  const rest = md.slice(m[0].length)
  const single = body.match(/^description:\s*(.+)$/m)
  if (single) return { md: rest, description: decodeEntities(single[1].trim()) }
  const folded = body.match(/^description:\s*>-?\n((?:[ \t]+.+\n?)+)/m)
  if (folded) {
    const text = folded[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
    return { md: rest, description: decodeEntities(text) }
  }
  return { md: rest, description: '' }
}

export function markdownToBlocks(markdown: string): ConvertResult {
  // Normalize line endings and drop GitBook's machine preamble + agent footer.
  let md = markdown.replace(/\r\n/g, '\n')
  const fm = stripFrontmatter(md)
  md = fm.md
  // Remove leading "> For the complete documentation index..." note.
  md = md.replace(/^>\s*For the complete documentation index[^\n]*\n+/, '')
  // Drop the trailing "# Agent Instructions" GitBook section if present.
  const agentIdx = md.indexOf('\n# Agent Instructions')
  if (agentIdx !== -1) md = md.slice(0, agentIdx)
  // Strip trailing horizontal rule before the agent section.
  md = md.replace(/\n+---\s*$/, '')

  const lines = md.split('\n')
  const blocks: Block[] = []
  let title = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Page title (first H1)
    const h1 = line.match(/^#\s+(.*)$/)
    if (h1 && !title) {
      title = decodeEntities(h1[1].trim())
      i++
      continue
    }

    // Headings H2-H4 (H1 after title becomes H2)
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = Math.min(Math.max(h[1].length, 2), 4)
      blocks.push(makeBlock('heading', parseInline(h[2].trim()), { level }))
      i++
      continue
    }

    // Fenced code block
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1] || ''
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push(
        makeBlock('codeBlock', [{ type: 'text', text: code.join('\n'), styles: {} }], { language: lang || 'text' })
      )
      continue
    }

    // GitBook hint -> callout
    const hint = line.match(/^\{%\s*hint\s+style="(\w+)"\s*%\}/)
    if (hint) {
      const calloutType = HINT_TYPE_MAP[hint[1]] ?? 'info'
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].includes('{% endhint %}')) {
        body.push(lines[i])
        i++
      }
      i++ // skip endhint
      const textBody = body.join(' ').trim()
      blocks.push(makeBlock('callout', parseInline(textBody), { type: calloutType }))
      continue
    }

    // GitBook tabs -> flattened sequential sections (BlockNote has no tab
    // widget; each {% tab title="X" %} becomes a heading, content follows
    // inline in reading order — no data lost, just no click-to-switch UI).
    if (/^\{%\s*(end)?tabs\s*%\}/.test(line)) {
      i++
      continue
    }
    const tab = line.match(/^\{%\s*tab\s+title="([^"]*)"\s*%\}/)
    if (tab) {
      blocks.push(makeBlock('heading', parseInline(tab[1].trim()), { level: 4 }))
      i++
      continue
    }
    if (/^\{%\s*endtab\s*%\}/.test(line)) {
      i++
      continue
    }

    // GitBook content-ref -> a plain link paragraph to the referenced page.
    const contentRef = line.match(/^\{%\s*content-ref\s+url="([^"]+)"\s*%\}/)
    if (contentRef) {
      const url = contentRef[1]
      const inner: string[] = []
      i++
      while (i < lines.length && !lines[i].includes('{% endcontent-ref %}')) {
        inner.push(lines[i])
        i++
      }
      i++ // skip endcontent-ref
      const raw = inner.join(' ').trim()
      const linkMatch = raw.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
      const label = linkMatch ? linkMatch[1] : raw || url
      blocks.push(makeBlock('paragraph', parseInline(`[${label}](${url})`)))
      continue
    }

    // GitBook embed -> embed block (responsive iframe for YouTube/Vimeo/etc.)
    const embed = line.match(/^\{%\s*embed\s+url="([^"]+)"\s*%\}/)
    if (embed) {
      const url = embed[1].replace(/^<|>$/g, '')
      const caption: string[] = []
      i++
      while (i < lines.length && !lines[i].includes('{% endembed %}')) {
        caption.push(lines[i])
        i++
      }
      i++ // skip endembed
      blocks.push(makeEmbedBlock(url, decodeEntities(caption.join(' ').trim())))
      continue
    }

    // GitBook/HTML figure -> image block (src resolved by the import route)
    if (line.includes('<figure>')) {
      const figChunk: string[] = []
      while (i < lines.length && !lines[i].includes('</figure>')) {
        figChunk.push(lines[i])
        i++
      }
      if (i < lines.length) {
        figChunk.push(lines[i])
        i++
      }
      const fig = figChunk.join(' ')
      const srcMatch = fig.match(/<img[^>]*\bsrc="([^"]+)"/)
      const capMatch = fig.match(/<figcaption>\s*<p>(.*?)<\/p>\s*<\/figcaption>/)
      const caption = capMatch ? decodeEntities(capMatch[1].trim()) : ''
      if (srcMatch) {
        const src = srcMatch[1]
        // GitBook relative refs (/files/ID) become a placeholder the import resolves.
        const fileRef = src.match(/^\/files\/([A-Za-z0-9_-]+)/)
        const url = fileRef ? `gitbook-file:${fileRef[1]}` : src
        blocks.push(makeImageBlock(url, caption))
      } else if (caption) {
        blocks.push(makeBlock('paragraph', [{ type: 'text', text: caption, styles: { italic: true } }]))
      }
      continue
    }

    // Markdown image: ![alt](url) on its own line
    const mdImg = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (mdImg) {
      const alt = decodeEntities(mdImg[1].trim())
      // CommonMark's <...> destination form (needed for URLs with spaces).
      const src = mdImg[2].trim().replace(/^<|>$/g, '')
      const fileRef = src.match(/^\/files\/([A-Za-z0-9_-]+)/)
      const url = fileRef ? `gitbook-file:${fileRef[1]}` : src
      blocks.push(makeImageBlock(url, alt))
      i++
      continue
    }

    // Divider
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      blocks.push(makeBlock('divider', undefined))
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push(makeBlock('quote', parseInline(quote.join(' ').trim())))
      continue
    }

    // List items (bullet / numbered), with one level of nesting via indentation
    const listMatch = line.match(/^(\s*)([*\-+]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const indent = listMatch[1].length
      const ordered = /\d+\./.test(listMatch[2])
      const type = ordered ? 'numberedListItem' : 'bulletListItem'
      const block = makeBlock(type, parseInline(listMatch[3].trim()))
      // Attach to parent as child if indented under the previous list item.
      const prev = blocks[blocks.length - 1]
      if (indent >= 2 && prev && (prev.type === 'bulletListItem' || prev.type === 'numberedListItem')) {
        prev.children.push(block)
      } else {
        blocks.push(block)
      }
      i++
      continue
    }

    // Default: paragraph. Merge consecutive non-empty, non-special lines.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>|\s*[*\-+]\s|\s*\d+\.\s|<figure>|\{%)/.test(lines[i]) &&
      !/^(\*\*\*|---|___)\s*$/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(makeBlock('paragraph', parseInline(para.join(' ').trim())))
  }

  return { title: title || 'Untitled', description: fm.description, blocks }
}
