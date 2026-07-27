'use client'

import { useState } from 'react'
import { Sparkles, Search, BookOpen, FolderTree } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ConnectOptions } from '@/components/mcp/ConnectOptions'
import { useDict } from '@/components/i18n/DictionaryProvider'

export function McpButton() {
  const [open, setOpen] = useState(false)
  const dict = useDict()
  const TOOLS = [
    { icon: Search, label: dict.mcp.toolSearchLabel, desc: dict.mcp.toolSearchDesc },
    { icon: BookOpen, label: dict.mcp.toolReadLabel, desc: dict.mcp.toolReadDesc },
    { icon: FolderTree, label: dict.mcp.toolBrowseLabel, desc: dict.mcp.toolBrowseDesc },
  ]
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          aria-label={dict.mcp.ariaLabel}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">MCP</span>
        </button>
      </DialogTrigger>

      <DialogContent className="w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:w-full sm:max-w-md">
        {/* Single min-w-0 child so the dialog grid can't be widened by content. */}
        <div className="flex max-h-[85vh] min-w-0 flex-col overflow-y-auto">
        {/* Hero */}
        <div className="brand-glow relative overflow-hidden border-b border-border/60 px-5 pb-5 pt-6 sm:px-6">
          <div className="eyebrow mb-2 flex items-center gap-2 text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
            </span>
            Model Context Protocol · {dict.mcp.live}
          </div>
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="font-display text-xl">
              {dict.mcp.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {dict.mcp.description}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-w-0 space-y-5 px-5 py-5 sm:px-6">
          {/* What it can do */}
          <div className="grid gap-2">
            {TOOLS.map((t) => (
              <div key={t.label} className="flex items-start gap-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Connect */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{dict.mcp.connectInSeconds}</p>
            <ConnectOptions path="/api/mcp" name="flytbase-docs" />
          </div>

          <p className="text-xs text-muted-foreground">
            {dict.mcp.footer}
          </p>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
