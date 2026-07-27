'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useDict } from '@/components/i18n/DictionaryProvider'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const dict = useDict()

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      aria-label={dict.code.copy}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-green-400" /> <span className="text-xs">{dict.code.copied}</span>
        </>
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  )
}
