import { AlertTriangle, Info, XCircle, CheckCircle } from 'lucide-react'
import { toEmbedUrl, isVideoFile, videoThumbnail } from '@/lib/utils/embed'
import { CodeBlockView } from './CodeBlockView'
import { LinkPreviewCard } from './LinkPreviewCard'
import { resolveInternalLink, knownOriginsFor } from '@/lib/docs/resolveInternalLink'

// Same two projects proxy.ts/extractPageLinks.ts already hardcode. Computed
// once at module load — no I/O, no per-render cost.
const KNOWN_ORIGINS = knownOriginsFor(['flytbase-docs', 'flytbase-releases'])

// Plain JSON types matching BlockNote's output format
type TextStyle = { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean; underline?: boolean }
type StyledText = { type: 'text'; text: string; styles: TextStyle }
type LinkContent = { type: 'link'; href: string; content: InlineNode[] }
type InlineNode = StyledText | LinkContent

type BlockContent = InlineNode[] | { type: 'tableContent'; rows: { cells: { content: InlineNode[] }[] }[] }

interface DocBlock {
  id: string
  type: string
  props: Record<string, unknown>
  content?: BlockContent
  children?: DocBlock[]
}

function renderInline(content: InlineNode[]): React.ReactNode {
  return content.map((node, i) => {
    if (node.type === 'link') {
      const linkClassName = 'text-primary underline underline-offset-2 hover:opacity-80'
      // Known-internal links get a hover preview; everything else (external
      // sites, mailto:, anchors) renders exactly as before, untouched.
      if (resolveInternalLink(node.href, KNOWN_ORIGINS)) {
        return (
          <LinkPreviewCard key={i} href={node.href} className={linkClassName}>
            {renderInline(node.content)}
          </LinkPreviewCard>
        )
      }
      return (
        <a
          key={i}
          href={node.href}
          target={node.href?.startsWith('http') ? '_blank' : undefined}
          rel="noopener noreferrer"
          className={linkClassName}
        >
          {renderInline(node.content)}
        </a>
      )
    }
    let el: React.ReactNode = node.text
    if (node.styles?.code) el = <code key={`c${i}`} className="font-mono bg-muted px-1 py-0.5 rounded-none text-sm">{el}</code>
    if (node.styles?.bold) el = <strong key={`b${i}`}>{el}</strong>
    if (node.styles?.italic) el = <em key={`i${i}`}>{el}</em>
    if (node.styles?.strikethrough) el = <del key={`s${i}`}>{el}</del>
    if (node.styles?.underline) el = <span key={`u${i}`} className="underline">{el}</span>
    return <span key={i}>{el}</span>
  })
}

const CALLOUT_STYLES = {
  info:    { bg: 'bg-blue-500/10 border-blue-500/30',   Icon: Info,          color: 'text-blue-400'   },
  warning: { bg: 'bg-yellow-500/10 border-yellow-500/30', Icon: AlertTriangle, color: 'text-yellow-400' },
  danger:  { bg: 'bg-red-500/10 border-red-500/30',     Icon: XCircle,       color: 'text-red-400'    },
  success: { bg: 'bg-green-500/10 border-green-500/30', Icon: CheckCircle,   color: 'text-green-400'  },
} as const

function renderBlock(block: DocBlock, index: number, print = false): React.ReactNode {
  const inlineContent = Array.isArray(block.content) ? (block.content as InlineNode[]) : []

  switch (block.type) {
    case 'heading': {
      const level = (block.props.level as number) ?? 1
      const id = `h-${index}`
      const sizeMap: Record<number, string> = { 1: 'text-3xl', 2: 'text-2xl', 3: 'text-xl', 4: 'text-lg', 5: 'text-base', 6: 'text-sm' }
      const Tag = `h${Math.min(level, 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag key={index} id={id} className={`${sizeMap[level] ?? 'text-xl'} font-bold mt-8 mb-3 scroll-mt-20`}>
          {renderInline(inlineContent)}
        </Tag>
      )
    }

    case 'paragraph':
      if (inlineContent.length === 0) return <div key={index} className="h-4" />
      return (
        <p key={index} className="text-base leading-7 mb-4">
          {renderInline(inlineContent)}
        </p>
      )

    case 'bulletListItem':
      return (
        <li key={index} className="ml-6 list-disc text-base leading-7 mb-1">
          {renderInline(inlineContent)}
          {(block.children?.length ?? 0) > 0 && (
            <ul className="mt-1">{block.children?.map((c, i) => renderBlock(c, i, print))}</ul>
          )}
        </li>
      )

    case 'numberedListItem':
      return (
        <li key={index} className="ml-6 list-decimal text-base leading-7 mb-1">
          {renderInline(inlineContent)}
          {(block.children?.length ?? 0) > 0 && (
            <ol className="mt-1">{block.children?.map((c, i) => renderBlock(c, i, print))}</ol>
          )}
        </li>
      )

    case 'checkListItem': {
      const checked = (block.props.checked as boolean) ?? false
      return (
        <li key={index} className="flex items-start gap-2 text-base leading-7 mb-1 list-none ml-2">
          <input type="checkbox" checked={checked} readOnly className="mt-1 accent-primary flex-shrink-0" />
          <span className={checked ? 'line-through text-muted-foreground' : ''}>{renderInline(inlineContent)}</span>
        </li>
      )
    }

    case 'codeBlock': {
      const language = (block.props.language as string | { language: string }) ?? ''
      const lang = typeof language === 'object' ? language.language : language
      const code = inlineContent.map((n) => (n as StyledText).text).join('')
      return <CodeBlockView key={index} code={code} lang={lang || 'text'} />
    }

    case 'image': {
      const url = block.props.url as string | undefined
      const caption = block.props.caption as string | undefined
      if (!url) return null
      // Respect the authored width so images aren't forced full-bleed.
      const previewWidth = block.props.previewWidth as number | undefined
      const maxWidth = previewWidth ? `${previewWidth}px` : undefined
      return (
        <figure key={index} className="my-6" style={{ maxWidth }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption ?? ''}
            // Eager in print: Puppeteer's offscreen viewport never triggers
            // lazy loads, so below-the-fold images would be stripped from the PDF.
            loading={print ? 'eager' : 'lazy'}
            className="rounded-lg border border-border max-w-full h-auto mx-auto"
          />
          {caption && (
            <figcaption className="text-sm text-muted-foreground text-center mt-2">{caption}</figcaption>
          )}
        </figure>
      )
    }

    case 'columnList': {
      const columns = block.children ?? []
      const totalWidth = columns.reduce((sum, c) => sum + ((c.props?.width as number) ?? 1), 0) || columns.length
      return (
        <div key={index} className="flex flex-col md:flex-row gap-6 my-6 items-start">
          {columns.map((col, ci) => (
            <div
              key={col.id ?? ci}
              className="min-w-0 flex-1"
              style={{ flexGrow: (col.props?.width as number) ?? 1, flexBasis: `${(((col.props?.width as number) ?? 1) / totalWidth) * 100}%` }}
            >
              {groupBlocks(col.children ?? [], print)}
            </div>
          ))}
        </div>
      )
    }

    case 'column':
      // Rendered by its parent columnList; render children if reached directly.
      return <div key={index}>{groupBlocks(block.children ?? [], print)}</div>

    case 'embed': {
      const url = block.props.url as string | undefined
      const caption = block.props.caption as string | undefined
      if (!url) return null
      const embed = toEmbedUrl(url)

      // PDF/print: video can't play — show a clickable poster with a ▶ overlay.
      if (print) {
        const thumb = videoThumbnail(url)
        return (
          <figure key={index} className="my-6 break-inside-avoid">
            <a href={url} target="_blank" rel="noopener noreferrer" className="block relative rounded-lg overflow-hidden border border-border">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt={caption ?? 'Video'} className="w-full h-auto" />
              ) : (
                <div className="w-full bg-muted flex items-center justify-center" style={{ aspectRatio: '16 / 9' }} />
              )}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center text-white text-2xl">▶</span>
              </span>
            </a>
            <figcaption className="text-sm text-muted-foreground mt-2">
              {caption ? `${caption} — ` : ''}
              <a href={url} className="text-primary underline break-all">Watch video: {url}</a>
            </figcaption>
          </figure>
        )
      }

      return (
        <figure key={index} className="my-6">
          {embed ? (
            <div className="relative w-full overflow-hidden rounded-lg border border-border" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                src={embed.src}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={caption ?? 'Embedded video'}
              />
            </div>
          ) : isVideoFile(url) ? (
            <video
              src={url}
              autoPlay
              loop
              muted
              playsInline
              controls
              preload="metadata"
              className="w-full rounded-lg border border-border"
            />
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {caption ?? url}
            </a>
          )}
          {caption && (
            <figcaption className="text-sm text-muted-foreground text-center mt-2">{caption}</figcaption>
          )}
        </figure>
      )
    }

    case 'callout': {
      const type = (block.props.type as string) ?? 'info'
      const style = CALLOUT_STYLES[type as keyof typeof CALLOUT_STYLES] ?? CALLOUT_STYLES.info
      const Icon = style.Icon
      return (
        <div key={index} className={`flex gap-3 p-4 rounded-lg border my-4 ${style.bg}`}>
          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.color}`} />
          <p className="text-sm leading-relaxed">{renderInline(inlineContent)}</p>
        </div>
      )
    }

    case 'quote':
      return (
        <blockquote key={index} className="border-l-4 border-primary pl-4 my-4 text-muted-foreground italic">
          {renderInline(inlineContent)}
        </blockquote>
      )

    case 'divider':
      return <hr key={index} className="my-6 border-border" />

    case 'table': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableBody = block.content as any
      if (!tableBody?.rows?.length) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [headerRow, ...bodyRows]: any[] = tableBody.rows
      return (
        <div key={index} className="my-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {headerRow && (
              <thead>
                <tr>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {headerRow.cells.map((cell: any, ci: number) => (
                    <th key={ci} className="border border-border bg-muted px-4 py-2 text-left font-semibold">
                      {renderInline(cell.content)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {bodyRows.map((row: any, ri: number) => (
                <tr key={ri} className="even:bg-muted/20">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {row.cells.map((cell: any, ci: number) => (
                    <td key={ci} className="border border-border px-4 py-2">{renderInline(cell.content)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    default:
      if (inlineContent.length > 0) {
        return <p key={index} className="text-base leading-7 mb-4">{renderInline(inlineContent)}</p>
      }
      return null
  }
}

function groupBlocks(blocks: DocBlock[], print = false): React.ReactNode[] {
  const result: React.ReactNode[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'bulletListItem') {
      const items: React.ReactNode[] = []
      while (i < blocks.length && blocks[i].type === 'bulletListItem') {
        items.push(renderBlock(blocks[i], i, print)); i++
      }
      result.push(<ul key={`ul-${i}`} className="my-4">{items}</ul>)
    } else if (block.type === 'numberedListItem') {
      const items: React.ReactNode[] = []
      while (i < blocks.length && blocks[i].type === 'numberedListItem') {
        items.push(renderBlock(blocks[i], i, print)); i++
      }
      result.push(<ol key={`ol-${i}`} className="my-4">{items}</ol>)
    } else if (block.type === 'checkListItem') {
      const items: React.ReactNode[] = []
      while (i < blocks.length && blocks[i].type === 'checkListItem') {
        items.push(renderBlock(blocks[i], i, print)); i++
      }
      result.push(<ul key={`cl-${i}`} className="my-4">{items}</ul>)
    } else {
      result.push(renderBlock(block, i, print)); i++
    }
  }
  return result
}

export function BlockRenderer({
  blocks,
  print = false,
  emptyLabel = 'This page has no content yet.',
}: {
  blocks: DocBlock[]
  print?: boolean
  emptyLabel?: string
}) {
  if (!blocks?.length) {
    return <p className="text-muted-foreground italic">{emptyLabel}</p>
  }
  return <>{groupBlocks(blocks, print)}</>
}
