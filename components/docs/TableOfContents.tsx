'use client'

import { useEffect, useState } from 'react'
import type { Block } from '@blocknote/core'
import { useDict } from '@/components/i18n/DictionaryProvider'

interface Heading {
  id: string
  text: string
  level: number
}

function extractHeadings(blocks: Block[]): Heading[] {
  const headings: Heading[] = []
  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      const level = (block.props as { level?: number }).level ?? 1
      const text = (block.content as { text: string }[] | undefined)
        ?.map((n) => n.text)
        .join('') ?? ''
      if (text) {
        headings.push({ id: `h-${index}`, text, level })
      }
    }
  })
  return headings
}

export function TableOfContents({ blocks }: { blocks: Block[] }) {
  const dict = useDict()
  const headings = extractHeadings(blocks)
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    )

    headings.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {dict.nav.onThisPage}
      </p>
      <ul className="space-y-1">
        {headings.map(({ id, text, level }) => (
          <li key={id} style={{ paddingLeft: `${(level - 1) * 8}px` }}>
            <a
              href={`#${id}`}
              className={`block text-xs py-0.5 leading-snug truncate transition-colors ${
                activeId === id
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
