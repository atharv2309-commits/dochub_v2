'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { HoverCard } from 'radix-ui'
import { useDict } from '@/components/i18n/DictionaryProvider'

interface PreviewData {
  title: string
  paragraphs: string[]
}

// Wraps an already-resolved-internal link in a Radix hover card that lazily
// fetches a preview (title/excerpt/thumbnail) from /api/docs/preview on
// hover. The underlying <a> is unchanged — clicking always navigates
// normally; the card is purely an added hover affordance.
export function LinkPreviewCard({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  const dict = useDict()
  // Same trick LanguageSwitcher.tsx uses: the locale segment is always
  // pathname.split('/')[1] on this app's routes — no prop-threading needed
  // through the whole server-rendered block tree just for this.
  const pathname = usePathname()
  const lang = pathname.split('/')[1] || 'en'

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle')
  const [data, setData] = useState<PreviewData | null>(null)

  async function load() {
    if (status !== 'idle') return
    setStatus('loading')
    try {
      const res = await fetch(`/api/docs/preview?href=${encodeURIComponent(href)}&lang=${lang}`)
      if (!res.ok) {
        setStatus('none')
        return
      }
      setData(await res.json())
      setStatus('ready')
    } catch {
      setStatus('none')
    }
  }

  return (
    <HoverCard.Root openDelay={250} closeDelay={100} onOpenChange={(open) => open && load()}>
      {/* No asChild/inner <a>: Radix's HoverCard.Trigger already renders as an
          <a> itself and attaches its own hover listeners directly to it.
          Wrapping a separate <a> via asChild relies on Slot ref-forwarding
          that wasn't firing here — this sidesteps that entirely. */}
      <HoverCard.Trigger href={href} className={className}>
        {children}
      </HoverCard.Trigger>
      {status !== 'none' && (
        <HoverCard.Portal>
          <HoverCard.Content
            side="top"
            align="start"
            sideOffset={8}
            className="z-50 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg flex flex-col"
          >
            {status === 'loading' || !data ? (
              <p className="text-xs text-muted-foreground p-3">{dict.linkPreview.loading}</p>
            ) : (
              <>
                <p className="font-medium text-sm leading-snug px-3 pt-3 pb-2 shrink-0 border-b border-border">{data.title}</p>
                <div className="space-y-2 overflow-y-auto max-h-64 px-3 py-2">
                  {data.paragraphs.map((p, i) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              </>
            )}
            <HoverCard.Arrow className="fill-popover" />
          </HoverCard.Content>
        </HoverCard.Portal>
      )}
    </HoverCard.Root>
  )
}
