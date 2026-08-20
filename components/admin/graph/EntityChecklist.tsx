'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import { markEntityChanged, reviewLink } from '@/app/(admin)/admin/graph/actions'
import type { GraphEntityNode, GraphPageNode, GraphEdge } from './types'
import type { EntityLinkStatus } from '@/types/db'

const STATUS_STYLES: Record<EntityLinkStatus, string> = {
  ok: 'bg-emerald-500/10 text-emerald-500',
  stale: 'bg-amber-500/10 text-amber-500',
  gap: 'bg-destructive/10 text-destructive',
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MarkChangedForm({ entity }: { entity: GraphEntityNode }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">
        Mark changed
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What changed?"
        className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs w-48"
      />
      <button
        onClick={() => startTransition(async () => { await markEntityChanged(entity.id, note); setOpen(false); setNote('') })}
        disabled={pending}
        className="px-2 py-1 rounded-md text-xs bg-primary text-primary-foreground disabled:opacity-60"
      >
        {pending ? '…' : 'Confirm'}
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
    </div>
  )
}

function ReviewButtons({ linkId }: { linkId: string }) {
  const [pending, startTransition] = useTransition()
  function set(status: EntityLinkStatus) {
    startTransition(() => reviewLink(linkId, status))
  }
  return (
    <div className="flex items-center gap-1">
      {(['ok', 'stale', 'gap'] as const).map((s) => (
        <button
          key={s}
          onClick={() => set(s)}
          disabled={pending}
          className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border border-border hover:bg-secondary/60 disabled:opacity-50 ${STATUS_STYLES[s]}`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

export function EntityChecklist({
  entities,
  pages,
  edges,
}: {
  entities: GraphEntityNode[]
  pages: GraphPageNode[]
  edges: GraphEdge[]
}) {
  const pageById = new Map(pages.map((p) => [p.id, p]))

  if (entities.length === 0) {
    return <p className="text-sm text-muted-foreground">No entities yet — add one to start tagging pages.</p>
  }

  return (
    <div className="space-y-5">
      {entities.map((entity) => {
        const links = edges.filter((e): e is GraphEdge & { entityLinkId: string } => e.kind === 'entity-link' && e.target === entity.id && !!e.entityLinkId)
        return (
          <div key={entity.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="font-semibold flex items-center gap-2">
                  {entity.name}
                  {entity.versionTag && <span className="text-xs text-muted-foreground">({entity.versionTag})</span>}
                </p>
                {entity.description && <p className="text-xs text-muted-foreground mt-0.5">{entity.description}</p>}
                {entity.changedAt && (
                  <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Changed {timeAgo(entity.changedAt)}{entity.changeNote ? ` — ${entity.changeNote}` : ''}
                  </p>
                )}
              </div>
              <MarkChangedForm entity={entity} />
            </div>

            {links.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pages linked yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {links.map((l) => {
                  const page = pageById.get(l.source)
                  if (!page) return null
                  return (
                    <li key={l.entityLinkId} className="py-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          {l.needsAttention ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          )}
                          <Link href={`/en/docs/${page.projectSlug}/${page.path}`} target="_blank" className="truncate hover:text-primary transition-colors">
                            {page.title}
                          </Link>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0 uppercase">
                            {l.entityLinkKind}
                          </span>
                          {l.entityLinkStatus && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 uppercase ${STATUS_STYLES[l.entityLinkStatus]}`}>
                              {l.entityLinkStatus}
                            </span>
                          )}
                          {l.entityLinkSource === 'ai' && (
                            <span
                              title="Classified by Gemini, not yet human-confirmed"
                              className="text-[10px] px-1.5 py-0.5 rounded shrink-0 bg-violet-500/10 text-violet-400 flex items-center gap-0.5"
                            >
                              <Sparkles className="w-2.5 h-2.5" /> AI
                            </span>
                          )}
                        </div>
                        <ReviewButtons linkId={l.entityLinkId} />
                      </div>
                      {l.note && <p className="text-xs text-muted-foreground mt-0.5 ml-5">{l.note}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
