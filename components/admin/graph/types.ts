import type { EntityLinkKind, EntityLinkStatus } from '@/types/db'

export interface GraphPageNode {
  kind: 'page'
  id: string
  title: string
  path: string
  projectSlug: string
  excerpt: string
  thumbnailUrl: string | null
  status: 'attention' | 'ok' | 'none'
}

export interface GraphEntityNode {
  kind: 'entity'
  id: string
  projectId: string
  name: string
  description: string | null
  referenceImageUrl: string | null
  versionTag: string | null
  changedAt: string | null
  changeNote: string | null
}

export type GraphNode = GraphPageNode | GraphEntityNode

export interface GraphEdge {
  source: string
  target: string
  kind: 'page-link' | 'entity-link'
  linkText?: string | null
  entityLinkId?: string
  entityLinkKind?: EntityLinkKind
  entityLinkStatus?: EntityLinkStatus
  entityLinkSource?: string | null
  note?: string | null
  reviewedAt?: string
  needsAttention?: boolean
}

export interface ProjectSummary {
  id: string
  slug: string
  name: string
}
