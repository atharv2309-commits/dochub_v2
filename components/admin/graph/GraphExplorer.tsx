'use client'

import { useMemo, useState, useTransition } from 'react'
import { Network, List, RefreshCw, Plus } from 'lucide-react'
import { createEntity, triggerGraphSync } from '@/app/(admin)/admin/graph/actions'
import { ContentGraphView } from './ContentGraphView'
import { EntityChecklist } from './EntityChecklist'
import type { GraphPageNode, GraphEntityNode, GraphEdge, ProjectSummary } from './types'

export function GraphExplorer({
  projects,
  pageNodes,
  entityNodes,
  edges,
}: {
  projects: ProjectSummary[]
  pageNodes: GraphPageNode[]
  entityNodes: GraphEntityNode[]
  edges: GraphEdge[]
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [view, setView] = useState<'graph' | 'checklist'>('graph')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, startTransition] = useTransition()
  const [syncPending, startSync] = useTransition()

  const currentSlug = projects.find((pr) => pr.id === projectId)?.slug
  const ownPageIds = useMemo(() => new Set(pageNodes.filter((p) => p.projectSlug === currentSlug).map((p) => p.id)), [pageNodes, currentSlug])
  const ownEntityIds = useMemo(() => new Set(entityNodes.filter((e) => e.projectId === projectId).map((e) => e.id)), [entityNodes, projectId])

  // Edges touching this project on EITHER end — cross-project page links
  // (a release note linking to its feature doc in the other project) are
  // real and expected, not just edges fully contained within one project.
  const scopedEdges = useMemo(
    () => edges.filter((e) => ownPageIds.has(e.source) || ownPageIds.has(e.target) || ownEntityIds.has(e.target)),
    [edges, ownPageIds, ownEntityIds]
  )

  // Pull in the "foreign" pages those edges point at so force-graph has both
  // endpoints to draw — otherwise a link to another project's page has
  // nothing to connect to and silently vanishes.
  const scopedPageIds = useMemo(() => {
    const ids = new Set(ownPageIds)
    for (const e of scopedEdges) {
      if (e.kind === 'page-link') {
        ids.add(e.source)
        ids.add(e.target)
      } else {
        ids.add(e.source)
      }
    }
    return ids
  }, [scopedEdges, ownPageIds])

  const scopedPages = useMemo(() => pageNodes.filter((p) => scopedPageIds.has(p.id)), [pageNodes, scopedPageIds])
  const scopedEntities = useMemo(() => entityNodes.filter((e) => ownEntityIds.has(e.id)), [entityNodes, ownEntityIds])

  // Only count this project's own pages — a foreign page pulled in just to
  // draw a cross-project edge isn't "this project's" work item.
  const attentionCount = scopedPages.filter((p) => ownPageIds.has(p.id) && p.status === 'attention').length

  function submitCreate() {
    if (!name.trim()) return
    startTransition(async () => {
      await createEntity(projectId, name, description)
      setName('')
      setDescription('')
      setCreating(false)
    })
  }

  return (
    <main className="max-w-7xl mx-auto px-5 py-8">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-2.5">
          <Network className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Content Graph</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => startSync(() => triggerGraphSync())}
            disabled={syncPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncPending ? 'animate-spin' : ''}`} />
            {syncPending ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        What&apos;s connected to what — page-to-page links (mechanical) and page-to-entity dependencies (tag pages to
        product features/UI, then mark an entity changed to see every page that needs a look).
      </p>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg border border-border overflow-hidden ml-2">
          <button
            onClick={() => setView('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${view === 'graph' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Network className="w-3.5 h-3.5" /> Graph
          </button>
          <button
            onClick={() => setView('checklist')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-l border-border transition-colors ${view === 'checklist' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <List className="w-3.5 h-3.5" /> Checklist
          </button>
        </div>

        {attentionCount > 0 && (
          <span className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive font-medium">
            {attentionCount} page{attentionCount === 1 ? '' : 's'} need attention
          </span>
        )}

        <div className="ml-auto">
          {creating ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Entity name (e.g. Cockpit UI)"
                className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm w-48"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm w-48"
              />
              <button
                onClick={submitCreate}
                disabled={pending || !name.trim()}
                className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-60"
              >
                {pending ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => setCreating(false)} className="px-2 py-1.5 text-xs text-muted-foreground">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New entity
            </button>
          )}
        </div>
      </div>

      {view === 'graph' ? (
        <ContentGraphView pageNodes={scopedPages} entityNodes={scopedEntities} edges={scopedEdges} />
      ) : (
        <EntityChecklist entities={scopedEntities} pages={scopedPages} edges={scopedEdges} />
      )}
    </main>
  )
}
