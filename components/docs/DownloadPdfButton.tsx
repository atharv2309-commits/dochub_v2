'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useDict } from '@/components/i18n/DictionaryProvider'

export function DownloadPdfButton({ projectSlug, path }: { projectSlug: string; path: string }) {
  const [loading, setLoading] = useState(false)
  const dict = useDict()

  async function download() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/pdf/${projectSlug}/${path}`)
      if (!res.ok) throw new Error('failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${path.split('/').pop() || 'document'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Could not generate the PDF. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={download}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {loading ? dict.pdf.preparing : dict.pdf.label}
    </button>
  )
}
