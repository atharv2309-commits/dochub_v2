'use client'

import { useState } from 'react'
import {
  ChevronDown,
  Copy,
  Check,
  FileText,
  Sparkles,
  MessageSquare,
  Plug,
  Download,
  Loader2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ConnectOptions } from '@/components/mcp/ConnectOptions'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { trackEvent } from '@/lib/analytics/track'

// GitBook's own pattern: tell the assistant to fetch the page's real public
// URL rather than pasting content into the prompt (so it can browse/cite it).
function askPrompt(pageUrl: string): string {
  return `Read from ${pageUrl} so I can ask you questions about it.`
}

export function PageActionsMenu({
  projectSlug,
  projectId,
  pageId,
  path,
  lang,
}: {
  projectSlug: string
  projectId: string
  pageId: string
  path: string
  lang: string
}) {
  const dict = useDict()
  const [copied, setCopied] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)

  const markdownUrl = `/api/docs/${projectSlug}/${path}?lang=${lang}`
  const pageUrl = () => `${window.location.origin}/${lang}/docs/${projectSlug}/${path}`
  const track = (eventType: Parameters<typeof trackEvent>[0]) =>
    trackEvent(eventType, { projectId, pageId, locale: lang })

  async function copyPage() {
    try {
      const res = await fetch(markdownUrl)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      track('copy_page')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard/network unavailable — no-op */
    }
  }

  async function downloadPdf() {
    if (pdfLoading) return
    setPdfLoading(true)
    try {
      const res = await fetch(`/api/pdf/${projectSlug}/${path}?lang=${lang}`)
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
      track('pdf_download')
    } catch {
      alert('Could not generate the PDF. Please try again.')
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
            {dict.pageActions.menuLabel}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={copyPage}>
            {copied ? <Check className="text-green-400" /> : <Copy />}
            {copied ? dict.pageActions.copied : dict.pageActions.copyPage}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              track('view_markdown')
              window.open(markdownUrl, '_blank')
            }}
          >
            <FileText />
            {dict.pageActions.viewAsMarkdown}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              track('open_chatgpt')
              window.open(`https://chatgpt.com/?q=${encodeURIComponent(askPrompt(pageUrl()))}`, '_blank')
            }}
          >
            <MessageSquare />
            {dict.pageActions.openInChatGPT}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              track('open_claude')
              window.open(`https://claude.ai/new?q=${encodeURIComponent(askPrompt(pageUrl()))}`, '_blank')
            }}
          >
            <Sparkles />
            {dict.pageActions.openInClaude}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              track('mcp_connect_click')
              // Defer past the dropdown's own close/focus-return — opening a
              // Dialog synchronously from a menu item's onSelect races Radix's
              // focus trap and can no-op the open.
              setTimeout(() => setMcpOpen(true), 0)
            }}
          >
            <Plug />
            {dict.pageActions.connectWithMcp}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={downloadPdf} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="animate-spin" /> : <Download />}
            {dict.pageActions.downloadPdf}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dict.mcp.title}</DialogTitle>
            <DialogDescription>{dict.mcp.description}</DialogDescription>
          </DialogHeader>
          <ConnectOptions path="/api/mcp" name={projectSlug} />
        </DialogContent>
      </Dialog>
    </>
  )
}
