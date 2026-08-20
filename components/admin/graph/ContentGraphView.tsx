'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { X, ExternalLink, Link2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { unlinkPageFromEntity, linkPageToEntity, reviewLink } from '@/app/(admin)/admin/graph/actions'
import type { GraphPageNode, GraphEntityNode, GraphEdge } from './types'
import type { EntityLinkKind, EntityLinkStatus } from '@/types/db'

// force-graph touches window/canvas at import time — must never run during SSR.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

const PAGE_COLOR = { attention: '#f59e0b', ok: '#10b981', none: '#6b7280' }
const ENTITY_COLOR = '#8b5cf6'
const STATUS_BADGE: Record<EntityLinkStatus, string> = {
  ok: 'bg-emerald-500/10 text-emerald-500',
  stale: 'bg-amber-500/10 text-amber-500',
  gap: 'bg-destructive/10 text-destructive',
}

type Selected = { kind: 'page'; node: GraphPageNode } | { kind: 'entity'; node: GraphEntityNode } | null
type AnyNode = GraphPageNode | GraphEntityNode

// react-force-graph-2d's TS defs erase our node/link types once passed through
// next/dynamic's generic-less wrapper — these accessors take `any` at that
// boundary and cast back to our real types internally, which is where every
// other line in this file stays fully typed.
function nodeVal(n: any) { return (n as AnyNode).kind === 'entity' ? 3 : 1.5 } // eslint-disable-line @typescript-eslint/no-explicit-any
function nodeLabel(n: any) { const node = n as AnyNode; return node.kind === 'page' ? node.title : node.name } // eslint-disable-line @typescript-eslint/no-explicit-any
function nodeColor(n: any) { const node = n as AnyNode; return node.kind === 'page' ? PAGE_COLOR[node.status] : ENTITY_COLOR } // eslint-disable-line @typescript-eslint/no-explicit-any
function linkColor(l: any) { const link = l as GraphEdge; return link.kind === 'entity-link' ? (link.needsAttention ? '#f59e0b' : '#6b7280') : '#3f3f46' } // eslint-disable-line @typescript-eslint/no-explicit-any
function linkLineDash(l: any) { return (l as GraphEdge).kind === 'entity-link' ? [2, 2] : null } // eslint-disable-line @typescript-eslint/no-explicit-any
function linkWidth(l: any) { const link = l as GraphEdge; return link.kind === 'entity-link' && link.needsAttention ? 1.5 : 1 } // eslint-disable-line @typescript-eslint/no-explicit-any
function linkDirectionalArrowLength(l: any) { return (l as GraphEdge).kind === 'page-link' ? 3 : 0 } // eslint-disable-line @typescript-eslint/no-explicit-any

export function ContentGraphView({
  pageNodes,
  entityNodes,
  edges,
}: {
  pageNodes: GraphPageNode[]
  entityNodes: GraphEntityNode[]
  edges: GraphEdge[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 560 })
  const [selected, setSelected] = useState<Selected>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onNodeClick(n: any) {
    const node = n as AnyNode
    setSelected(node.kind === 'page' ? { kind: 'page', node } : { kind: 'entity', node })
  }

  useEffect(() => {
    function measure() {
      if (containerRef.current) setSize({ width: containerRef.current.clientWidth, height: 560 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const graphData = useMemo(
    () => ({
      nodes: [...pageNodes, ...entityNodes],
      links: edges.map((e) => ({ ...e })),
    }),
    [pageNodes, entityNodes, edges]
  )

  const pageById = useMemo(() => new Map(pageNodes.map((p) => [p.id, p])), [pageNodes])
  const entityById = useMemo(() => new Map(entityNodes.map((e) => [e.id, e])), [entityNodes])

  return (
    <div className="flex gap-4">
      <div ref={containerRef} className="flex-1 rounded-xl border border-border bg-card overflow-hidden">
        {pageNodes.length === 0 && entityNodes.length === 0 ? (
          <div className="h-[560px] flex items-center justify-center text-sm text-muted-foreground">
            Nothing to show yet — add an entity and link a page, or click &quot;Sync now&quot; to pull in page-to-page links.
          </div>
        ) : (
          <ForceGraph2D
            width={size.width}
            height={size.height}
            graphData={graphData}
            nodeId="id"
            nodeRelSize={5}
            nodeVal={nodeVal}
            nodeLabel={nodeLabel}
            nodeColor={nodeColor}
            linkColor={linkColor}
            linkLineDash={linkLineDash}
            linkWidth={linkWidth}
            linkDirectionalArrowLength={linkDirectionalArrowLength}
            backgroundColor="transparent"
            cooldownTicks={100}
            onNodeClick={onNodeClick}
            onBackgroundClick={() => setSelected(null)}
          />
        )}
      </div>

      {selected && (
        <SidePanel
          selected={selected}
          onClose={() => setSelected(null)}
          pageNodes={pageNodes}
          entityNodes={entityNodes}
          edges={edges}
          pageById={pageById}
          entityById={entityById}
        />
      )}
    </div>
  )
}

function SidePanel({
  selected,
  onClose,
  pageNodes,
  entityNodes,
  edges,
  pageById,
  entityById,
}: {
  selected: NonNullable<Selected>
  onClose: () => void
  pageNodes: GraphPageNode[]
  entityNodes: GraphEntityNode[]
  edges: GraphEdge[]
  pageById: Map<string, GraphPageNode>
  entityById: Map<string, GraphEntityNode>
}) {
  return (
    <div className="w-80 shrink-0 rounded-xl border border-border bg-card p-4 max-h-[560px] overflow-y-auto">
      <button onClick={onClose} className="float-right text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
      {selected.kind === 'page' ? (
        <PageDetail page={selected.node} edges={edges} pageById={pageById} entityById={entityById} entityNodes={entityNodes} />
      ) : (
        <EntityDetail entity={selected.node} edges={edges} pageById={pageById} pageNodes={pageNodes} />
      )}
    </div>
  )
}

function PageDetail({
  page,
  edges,
  pageById,
  entityById,
  entityNodes,
}: {
  page: GraphPageNode
  edges: GraphEdge[]
  pageById: Map<string, GraphPageNode>
  entityById: Map<string, GraphEntityNode>
  entityNodes: GraphEntityNode[]
}) {
  const outgoing = edges.filter((e) => e.kind === 'page-link' && e.source === page.id)
  const incoming = edges.filter((e) => e.kind === 'page-link' && e.target === page.id)
  const entityLinks = edges.filter((e): e is GraphEdge & { entityLinkId: string } => e.kind === 'entity-link' && e.source === page.id && !!e.entityLinkId)
  const linkedEntityIds = new Set(entityLinks.map((l) => l.target))
  const unlinkedEntities = entityNodes.filter((e) => !linkedEntityIds.has(e.id))

  return (
    <div className="space-y-4 pr-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Page</p>
        <Link href={`/en/docs/${page.projectSlug}/${page.path}`} target="_blank" className="font-semibold hover:text-primary flex items-center gap-1">
          {page.title} <ExternalLink className="w-3 h-3 shrink-0" />
        </Link>
        {page.excerpt && <p className="text-sm text-muted-foreground mt-1.5">{page.excerpt}</p>}
      </div>

      {page.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.thumbnailUrl} alt="" className="rounded-lg border border-border w-full object-cover max-h-32" />
      )}

      <EntitySection pageId={page.id} entityLinks={entityLinks} entityById={entityById} unlinkedEntities={unlinkedEntities} />

      {(outgoing.length > 0 || incoming.length > 0) && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
            <Link2 className="w-3 h-3" /> Page links
          </p>
          <ul className="space-y-1 text-sm">
            {outgoing.map((e, i) => {
              const target = pageById.get(e.target)
              return target ? <li key={`o${i}`}>→ {target.title}</li> : null
            })}
            {incoming.map((e, i) => {
              const source = pageById.get(e.source)
              return source ? <li key={`i${i}`}>← {source.title}</li> : null
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function EntitySection({
  pageId,
  entityLinks,
  entityById,
  unlinkedEntities,
}: {
  pageId: string
  entityLinks: (GraphEdge & { entityLinkId: string })[]
  entityById: Map<string, GraphEntityNode>
  unlinkedEntities: GraphEntityNode[]
}) {
  const [adding, setAdding] = useState(false)
  const [entityId, setEntityId] = useState(unlinkedEntities[0]?.id ?? '')
  const [kind, setKind] = useState<EntityLinkKind>('text')
  const [pending, startTransition] = useTransition()

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Depends on</p>
      {entityLinks.length === 0 && <p className="text-xs text-muted-foreground mb-2">Not linked to any entity yet.</p>}
      <ul className="space-y-1.5 mb-2">
        {entityLinks.map((l) => {
          const entity = entityById.get(l.target)
          if (!entity) return null
          return (
            <li key={l.entityLinkId} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  {l.needsAttention ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  )}
                  <span className="truncate">{entity.name}</span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-secondary text-muted-foreground uppercase shrink-0">{l.entityLinkKind}</span>
                  {l.entityLinkSource === 'ai' && (
                    <span title="Classified by Gemini, not yet human-confirmed" className="text-[10px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 shrink-0">
                      AI
                    </span>
                  )}
                </span>
                <button
                  onClick={() => startTransition(() => unlinkPageFromEntity(l.entityLinkId))}
                  disabled={pending}
                  className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                >
                  remove
                </button>
              </div>
              {l.note && <p className="text-xs text-muted-foreground mt-0.5 ml-5">{l.note}</p>}
            </li>
          )
        })}
      </ul>

      {unlinkedEntities.length > 0 &&
        (adding ? (
          <div className="flex items-center gap-1.5">
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs flex-1 min-w-0">
              {unlinkedEntities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as EntityLinkKind)} className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs">
              <option value="text">text</option>
              <option value="media">media</option>
              <option value="both">both</option>
            </select>
            <button
              onClick={() => startTransition(async () => { await linkPageToEntity(pageId, entityId, kind); setAdding(false) })}
              disabled={pending}
              className="px-2 py-1 rounded-md text-xs bg-primary text-primary-foreground disabled:opacity-60"
            >
              Add
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="text-xs text-primary hover:underline">
            + link an entity
          </button>
        ))}
    </div>
  )
}

function EntityDetail({
  entity,
  edges,
  pageById,
  pageNodes,
}: {
  entity: GraphEntityNode
  edges: GraphEdge[]
  pageById: Map<string, GraphPageNode>
  pageNodes: GraphPageNode[]
}) {
  const links = edges.filter((e): e is GraphEdge & { entityLinkId: string } => e.kind === 'entity-link' && e.target === entity.id && !!e.entityLinkId)
  const [pending, startTransition] = useTransition()
  void pageNodes

  return (
    <div className="space-y-4 pr-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Entity</p>
        <p className="font-semibold">{entity.name}</p>
        {entity.description && <p className="text-sm text-muted-foreground mt-1">{entity.description}</p>}
        {entity.changedAt && (
          <p className="text-xs text-amber-500 mt-1.5">
            Changed {new Date(entity.changedAt).toLocaleDateString()}{entity.changeNote ? ` — ${entity.changeNote}` : ''}
          </p>
        )}
      </div>

      {entity.referenceImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entity.referenceImageUrl} alt="" className="rounded-lg border border-border w-full object-cover max-h-32" />
      )}

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Linked pages ({links.length})</p>
        <ul className="space-y-1.5">
          {links.map((l) => {
            const page = pageById.get(l.source)
            if (!page) return null
            return (
              <li key={l.entityLinkId} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Link href={`/en/docs/${page.projectSlug}/${page.path}`} target="_blank" className="truncate hover:text-primary min-w-0">
                      {page.title}
                    </Link>
                    {l.entityLinkStatus && (
                      <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 uppercase ${STATUS_BADGE[l.entityLinkStatus]}`}>{l.entityLinkStatus}</span>
                    )}
                    {l.entityLinkSource === 'ai' && (
                      <span title="Classified by Gemini, not yet human-confirmed" className="text-[10px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 shrink-0">
                        AI
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => startTransition(() => reviewLink(l.entityLinkId, 'ok'))}
                    disabled={pending}
                    className="text-xs text-muted-foreground hover:text-emerald-500 shrink-0"
                  >
                    mark ok
                  </button>
                </div>
                {l.note && <p className="text-xs text-muted-foreground mt-0.5">{l.note}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
