'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { PageVersion } from '@/types/db'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { History, RotateCcw, Globe, Clock, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

function formatDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function VersionHistory({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [selected, setSelected] = useState<PageVersion | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function loadVersions() {
    setLoading(true)
    const { data } = await supabase
      .from('page_versions')
      .select('*')
      .eq('page_id', pageId)
      .order('version_number', { ascending: false })
    setVersions(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (open) loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleRestore(version: PageVersion) {
    if (!confirm(`Restore version ${version.version_number}? This becomes the new current version (your current content is preserved in history).`)) return
    setRestoring(version.id)
    const { error } = await supabase.rpc('restore_page_version', { p_version_id: version.id })
    setRestoring(null)
    if (error) {
      alert('Restore failed: ' + error.message)
      return
    }
    setOpen(false)
    setSelected(null)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 h-8 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <History className="w-3.5 h-3.5" />
        History
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="w-4 h-4" />
              Version history
            </DialogTitle>
            <DialogDescription className="text-xs">
              Every publish is snapshotted. Restore any version — history is never lost.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <div className="py-16 text-center">
                <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No versions yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Publishing this page creates the first version
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {versions.map((v, i) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors"
                  >
                    <span
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                        i === 0
                          ? 'bg-primary/15 text-primary'
                          : 'bg-secondary text-muted-foreground'
                      )}
                    >
                      v{v.version_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate">{v.title || 'Untitled'}</p>
                        {i === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {v.change_summary ?? (v.is_published ? 'Published' : 'Checkpoint')} ·{' '}
                        {formatDate(v.published_at ?? v.created_at)}
                      </p>
                    </div>
                    {v.is_published && (
                      <Globe className="w-3.5 h-3.5 text-green-400/70 shrink-0" />
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSelected(v)}
                      >
                        View
                      </Button>
                      {i !== 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => handleRestore(v)}
                          disabled={restoring === v.id}
                        >
                          {restoring === v.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Restore
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Read-only version preview */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
            <div>
              <DialogTitle className="text-base">
                Version {selected?.version_number}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {selected && formatDate(selected.published_at ?? selected.created_at)}
              </DialogDescription>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
            <h2 className="font-bold text-2xl mb-4">{selected?.title}</h2>
            <VersionContentPreview content={selected?.content} />
          </div>
          {selected && (
            <div className="px-5 py-3 border-t border-border flex justify-end">
              <Button
                size="sm"
                className="gap-2"
                onClick={() => handleRestore(selected)}
                disabled={restoring === selected.id}
              >
                {restoring === selected.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                Restore this version
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// Lightweight read-only preview of BlockNote JSON (plain text extraction)
function VersionContentPreview({ content }: { content: unknown }) {
  const blocks = Array.isArray(content) ? content : []
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No content</p>
  }
  return (
    <div className="space-y-2 text-sm text-foreground/90">
      {blocks.map((block: { id?: string; type?: string; content?: unknown }, i: number) => {
        const text = extractText(block.content)
        if (block.type?.startsWith('heading')) {
          return (
            <p key={block.id ?? i} className="font-semibold text-base mt-3">
              {text}
            </p>
          )
        }
        return <p key={block.id ?? i}>{text || ' '}</p>
      })}
    </div>
  )
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c: { text?: string }) => (typeof c?.text === 'string' ? c.text : ''))
    .join('')
}
