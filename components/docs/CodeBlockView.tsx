import { highlightCode } from '@/lib/highlight'
import { CopyButton } from './CopyButton'

// Async server component: Shiki-highlighted code block with a language label
// and a client-side copy button.
export async function CodeBlockView({ code, lang }: { code: string; lang: string }) {
  const html = await highlightCode(code, lang)
  return (
    <div className="my-4 rounded-lg border border-border overflow-hidden bg-[#1b1b1b]">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/60">
        <span className="text-xs text-muted-foreground font-mono">{lang || 'text'}</span>
        <CopyButton text={code} />
      </div>
      <div
        className="text-sm leading-relaxed [&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
