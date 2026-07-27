'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { toEmbedUrl, isVideoFile } from '@/lib/utils/embed'

export const embedBlockSpec = createReactBlockSpec(
  {
    type: 'embed' as const,
    content: 'none' as const,
    propSchema: {
      url: { default: '' as string },
      caption: { default: '' as string },
    },
  },
  {
    render: ({ block, editor }) => {
      const url = block.props.url as string
      const caption = block.props.caption as string
      const embed = toEmbedUrl(url)

      return (
        <div className="my-2 w-full" contentEditable={false}>
          {embed ? (
            <div className="relative w-full overflow-hidden rounded-lg border border-border" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                src={embed.src}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={caption || 'Embedded video'}
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
          ) : url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {caption || url}
            </a>
          ) : (
            <span className="text-muted-foreground text-sm">Empty embed</span>
          )}

          {editor.isEditable && (
            <input
              value={url}
              onChange={(e) => editor.updateBlock(block, { props: { url: e.target.value } })}
              placeholder="Paste a YouTube / Vimeo / video URL…"
              className="mt-2 w-full bg-secondary/40 border border-border rounded px-2 py-1 text-xs outline-none"
            />
          )}

          {caption && !editor.isEditable && (
            <p className="text-sm text-muted-foreground text-center mt-2">{caption}</p>
          )}
        </div>
      )
    },
  }
)
