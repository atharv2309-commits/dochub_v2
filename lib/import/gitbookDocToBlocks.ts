// Convert a GitBook structured document (from the GitBook API) into BlockNote
// block JSON. This preserves far more than the markdown export: tables, image
// widths + grouped/side-by-side images (columns), hints, embeds, code, nested
// lists, and inline marks. Image file refs become `gitbook-file:<id>` URLs that
// the import script resolves to self-hosted Supabase URLs afterwards.

/* eslint-disable @typescript-eslint/no-explicit-any */

let counter = 0
function id(): string {
  counter += 1
  return `gb-${counter.toString(36)}-${(counter * 2654435761 % 1e6).toString(36)}`
}

const TEXT_PROPS = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' as const }

export interface ConvertOptions {
  // Resolve an internal GitBook page id to a DocHub href (e.g. /docs/slug/path).
  internalHref?: (pageId: string) => string | null
}

type Style = Record<string, boolean>
type Inline =
  | { type: 'text'; text: string; styles: Style }
  | { type: 'link'; href: string; content: { type: 'text'; text: string; styles: Style }[] }

interface Block {
  id: string
  type: string
  props: Record<string, unknown>
  content?: Inline[] | unknown
  children: Block[]
}

const MARK_MAP: Record<string, string> = {
  bold: 'bold',
  italic: 'italic',
  code: 'code',
  'strikethrough-through': 'strike',
  strikethrough: 'strike',
}

function marksToStyles(marks: any[]): Style {
  const s: Style = {}
  for (const m of marks ?? []) {
    const mapped = MARK_MAP[m?.type]
    if (mapped) s[mapped] = true
  }
  return s
}

// Extract BlockNote inline content from a GitBook node's children (text + links).
function inlineFromNodes(nodes: any[], opts: ConvertOptions): Inline[] {
  const out: Inline[] = []
  for (const node of nodes ?? []) {
    if (node?.object === 'text') {
      for (const leaf of node.leaves ?? []) {
        const text = leaf?.text ?? ''
        if (text === '') continue
        out.push({ type: 'text', text, styles: marksToStyles(leaf.marks) })
      }
    } else if (node?.type === 'link' || node?.type === 'inline-link') {
      const href = resolveLinkHref(node, opts)
      const inner = inlineFromNodes(node.nodes ?? [], opts).filter((n) => n.type === 'text') as {
        type: 'text'; text: string; styles: Style
      }[]
      out.push({ type: 'link', href, content: inner.length ? inner : [{ type: 'text', text: href, styles: {} }] })
    } else if (Array.isArray(node?.nodes)) {
      out.push(...inlineFromNodes(node.nodes, opts))
    }
  }
  return out.length ? out : [{ type: 'text', text: '', styles: {} }]
}

function resolveLinkHref(node: any, opts: ConvertOptions): string {
  const ref = node?.data?.ref
  if (!ref) return node?.data?.href ?? '#'
  if (ref.kind === 'url') return ref.url ?? '#'
  if (ref.kind === 'anchor') return `#${ref.anchor ?? ''}`
  if (ref.kind === 'page' && ref.page) {
    const href = opts.internalHref?.(ref.page)
    if (href) return href
  }
  if (ref.kind === 'file') return '#'
  return ref.url ?? '#'
}

function block(type: string, content: Inline[] | unknown, props: Record<string, unknown> = {}, children: Block[] = []): Block {
  return { id: id(), type, props: { ...TEXT_PROPS, ...props }, content, children }
}

function imageBlock(fileRef: string, width: number | undefined, caption: string): Block {
  return {
    id: id(),
    type: 'image',
    props: {
      backgroundColor: 'default',
      textAlignment: 'left',
      name: '',
      url: fileRef,
      caption,
      showPreview: true,
      previewWidth: width ?? 768,
    },
    content: undefined,
    children: [],
  }
}

function plainText(nodes: any[]): string {
  let t = ''
  for (const n of nodes ?? []) {
    if (n?.object === 'text') for (const l of n.leaves ?? []) t += l?.text ?? ''
    if (Array.isArray(n?.nodes)) t += plainText(n.nodes)
  }
  return t
}

// Caption lives in a node's `fragments` array under fragment === 'caption'.
function captionOf(node: any, opts: ConvertOptions): string {
  const frag = (node?.fragments ?? []).find((f: any) => f?.fragment === 'caption')
  if (!frag) return ''
  const parts = inlineFromNodes(frag.nodes ?? [], opts)
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

// ── Tables ──────────────────────────────────────────────────────────────────
function convertTable(node: any, opts: ConvertOptions): Block {
  const data = node.data ?? {}
  const definition = data.definition ?? {}
  const records = data.records ?? {}
  const view = data.view ?? {}
  const columnOrder: string[] = Array.isArray(view.columns) && view.columns.length
    ? view.columns
    : Object.keys(definition)

  // Map cell-content key -> fragment nodes
  const fragByKey = new Map<string, any[]>()
  for (const f of node.fragments ?? []) {
    if (f?.fragment && f.fragment !== 'caption') fragByKey.set(f.fragment, f.nodes ?? [])
  }

  const cell = (inline: Inline[]) => ({
    type: 'tableCell',
    props: { colspan: 1, rowspan: 1, backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: inline,
  })

  const headerRow = {
    cells: columnOrder.map((k) =>
      cell([{ type: 'text', text: definition[k]?.title ?? '', styles: { bold: true } }])
    ),
  }

  const sortedRecords = Object.values(records).sort((a: any, b: any) =>
    String(a.orderIndex).localeCompare(String(b.orderIndex))
  )

  const bodyRows = sortedRecords.map((rec: any) => ({
    cells: columnOrder.map((k) => {
      const contentKey = rec.values?.[k]
      const nodes = contentKey ? fragByKey.get(contentKey) ?? [] : []
      // A cell fragment is usually a single paragraph; flatten to inline content.
      const para = (nodes[0]?.nodes) ? nodes[0].nodes : nodes
      return cell(inlineFromNodes(para, opts))
    }),
  }))

  return block(
    'table',
    {
      type: 'tableContent',
      columnWidths: columnOrder.map(() => undefined),
      headerRows: 1,
      rows: [headerRow, ...bodyRows],
    },
    {},
  )
}

// ── Images (single or grouped/side-by-side) ──────────────────────────────────
function convertImages(node: any, opts: ConvertOptions): Block {
  const imageNodes = (node.nodes ?? []).filter((n: any) => n?.type === 'image')
  const images = imageNodes.map((img: any) => {
    const fileId = img?.data?.ref?.kind === 'file' ? img.data.ref.file : null
    const url = fileId ? `gitbook-file:${fileId}` : img?.data?.ref?.url ?? ''
    return imageBlock(url, img?.data?.width, captionOf(img, opts))
  })

  if (images.length <= 1) return images[0] ?? block('paragraph', [{ type: 'text', text: '', styles: {} }])

  // Multiple images -> side-by-side columns
  const columns = images.map((img: Block, i: number) => {
    const w = (imageNodes[i]?.data?.width as number) ?? 1
    return { id: id(), type: 'column', props: { width: w || 1 }, content: undefined, children: [img] }
  })
  return { id: id(), type: 'columnList', props: {}, content: undefined, children: columns }
}

// ── Lists ────────────────────────────────────────────────────────────────────
function convertListItems(listNode: any, ordered: boolean, opts: ConvertOptions): Block[] {
  const items: Block[] = []
  for (const li of listNode.nodes ?? []) {
    if (li?.type !== 'list-item') continue
    const kids = li.nodes ?? []
    // First paragraph is the item text; subsequent nested lists become children.
    let inline: Inline[] = [{ type: 'text', text: '', styles: {} }]
    let gotText = false
    const children: Block[] = []
    for (const k of kids) {
      if (k?.type === 'paragraph' && !gotText) {
        inline = inlineFromNodes(k.nodes ?? [], opts)
        gotText = true
      } else if (k?.type === 'list-unordered') {
        children.push(...convertListItems(k, false, opts))
      } else if (k?.type === 'list-ordered') {
        children.push(...convertListItems(k, true, opts))
      } else if (k?.type === 'paragraph') {
        children.push(block('paragraph', inlineFromNodes(k.nodes ?? [], opts)))
      }
    }
    items.push(block(ordered ? 'numberedListItem' : 'bulletListItem', inline, {}, children))
  }
  return items
}

// ── Main node dispatch ────────────────────────────────────────────────────────
function convertNode(node: any, opts: ConvertOptions): Block[] {
  const t = node?.type
  switch (t) {
    case 'heading-1':
      return [block('heading', inlineFromNodes(node.nodes, opts), { level: 2 })]
    case 'heading-2':
      return [block('heading', inlineFromNodes(node.nodes, opts), { level: 3 })]
    case 'heading-3':
      return [block('heading', inlineFromNodes(node.nodes, opts), { level: 4 })]

    case 'paragraph': {
      const inline = inlineFromNodes(node.nodes, opts)
      if (inline.length === 1 && inline[0].type === 'text' && inline[0].text === '') return []
      return [block('paragraph', inline)]
    }

    case 'list-unordered':
      return convertListItems(node, false, opts)
    case 'list-ordered':
      return convertListItems(node, true, opts)

    case 'images':
      return [convertImages(node, opts)]
    case 'image':
      return [convertImages({ nodes: [node] }, opts)]

    case 'table':
      return [convertTable(node, opts)]

    case 'hint': {
      const styleMap: Record<string, string> = { info: 'info', warning: 'warning', danger: 'danger', success: 'success', tip: 'success' }
      const calloutType = styleMap[node?.data?.style] ?? 'info'
      // Flatten hint body paragraphs into the callout's inline content.
      const inner: Inline[] = []
      for (const c of node.nodes ?? []) {
        if (c?.type === 'paragraph') {
          if (inner.length) inner.push({ type: 'text', text: '\n', styles: {} })
          inner.push(...inlineFromNodes(c.nodes ?? [], opts))
        }
      }
      return [block('callout', inner.length ? inner : [{ type: 'text', text: '', styles: {} }], { type: calloutType })]
    }

    case 'embed':
      return [block('embed', undefined, { url: node?.data?.url ?? '', caption: captionOf(node, opts) })]

    case 'code': {
      const lang = node?.data?.syntax ?? node?.data?.language ?? 'text'
      const lines = (node.nodes ?? []).map((ln: any) => plainText(ln.nodes ?? [ln]))
      const codeText = lines.join('\n') || plainText(node.nodes ?? [])
      return [block('codeBlock', [{ type: 'text', text: codeText, styles: {} }], { language: typeof lang === 'string' ? lang : 'text' })]
    }

    case 'blockquote':
    case 'quote':
      return [block('quote', inlineFromNodes(flattenParas(node), opts))]

    case 'divider':
    case 'hr':
      return [block('divider', undefined)]

    case 'grid': {
      // Layout grid -> columns
      const cols = (node.nodes ?? []).map((c: any) => ({
        id: id(),
        type: 'column',
        props: { width: 1 },
        content: undefined,
        children: convertChildren(c?.nodes ?? [c], opts),
      }))
      if (cols.length) return [{ id: id(), type: 'columnList', props: {}, content: undefined, children: cols }]
      return convertChildren(node.nodes ?? [], opts)
    }

    case 'tabs': {
      // Graceful degrade: each tab becomes a labelled section.
      const out: Block[] = []
      for (const tab of node.nodes ?? []) {
        if (tab?.type !== 'tabs-item') continue
        const title = tab?.data?.title ?? 'Tab'
        out.push(block('heading', [{ type: 'text', text: title, styles: {} }], { level: 4 }))
        out.push(...convertChildren(tab.nodes ?? [], opts))
      }
      return out
    }

    case 'expandable':
    case 'expandable-item': {
      const out: Block[] = []
      const summary = node?.data?.title
      if (summary) out.push(block('paragraph', [{ type: 'text', text: summary, styles: { bold: true } }]))
      out.push(...convertChildren(node.nodes ?? [], opts))
      return out
    }

    case 'content-ref': {
      // Graceful degrade: a link "card" to the referenced page/url.
      const ref = node?.data?.ref
      let href = '#'
      let label = 'Read more'
      if (ref?.kind === 'url') { href = ref.url; label = ref.url }
      else if (ref?.kind === 'page' && ref.page) { href = opts.internalHref?.(ref.page) ?? '#' }
      return [block('paragraph', [
        { type: 'text', text: '→ ', styles: {} },
        { type: 'link', href, content: [{ type: 'text', text: label, styles: { bold: true } }] },
      ])]
    }

    case 'file': {
      const ref = node?.data?.ref
      const href = ref?.url ?? '#'
      return [block('paragraph', [
        { type: 'text', text: '📎 ', styles: {} },
        { type: 'link', href, content: [{ type: 'text', text: captionOf(node, opts) || 'Download file', styles: {} }] },
      ])]
    }

    default:
      // Unknown container: recurse into children if any.
      if (Array.isArray(node?.nodes) && node.nodes.length) return convertChildren(node.nodes, opts)
      return []
  }
}

function flattenParas(node: any): any[] {
  const out: any[] = []
  for (const c of node.nodes ?? []) {
    if (c?.type === 'paragraph') out.push(...(c.nodes ?? []))
    else out.push(c)
  }
  return out
}

function convertChildren(nodes: any[], opts: ConvertOptions): Block[] {
  const out: Block[] = []
  for (const n of nodes ?? []) out.push(...convertNode(n, opts))
  return out
}

export interface ConvertResult {
  title: string
  blocks: Block[]
}

export function gitbookDocToBlocks(page: any, opts: ConvertOptions = {}): ConvertResult {
  const doc = page?.document
  const nodes = doc?.nodes ?? []
  const blocks = convertChildren(nodes, opts)
  // Ensure at least one block so BlockNote is happy.
  if (blocks.length === 0) blocks.push(block('paragraph', [{ type: 'text', text: '', styles: {} }]))
  return { title: page?.title ?? 'Untitled', blocks }
}
