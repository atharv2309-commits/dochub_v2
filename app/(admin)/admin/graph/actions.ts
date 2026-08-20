'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { EntityLinkKind, EntityLinkStatus } from '@/types/db'

// All writes below run on the caller's session client — RLS's *_owner_all
// policies (content_entities/page_entity_links joined through projects.user_id)
// are what actually enforce ownership, same as connectGithubRepo in
// projects/[slug]/actions.ts. No separate ownership check needed.

export async function createEntity(projectId: string, name: string, description: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_entities')
    .insert({ project_id: projectId, name: name.trim(), description: description.trim() || null })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

export async function updateEntity(
  entityId: string,
  fields: { name?: string; description?: string; referenceImageUrl?: string; versionTag?: string }
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_entities')
    .update({
      ...(fields.name !== undefined && { name: fields.name.trim() }),
      ...(fields.description !== undefined && { description: fields.description.trim() || null }),
      ...(fields.referenceImageUrl !== undefined && { reference_image_url: fields.referenceImageUrl.trim() || null }),
      ...(fields.versionTag !== undefined && { version_tag: fields.versionTag.trim() || null }),
    })
    .eq('id', entityId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

export async function deleteEntity(entityId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('content_entities').delete().eq('id', entityId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

export async function linkPageToEntity(pageId: string, entityId: string, kind: EntityLinkKind, excerpt?: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('page_entity_links')
    .upsert(
      { page_id: pageId, entity_id: entityId, kind, excerpt: excerpt?.trim() || null, block_path: null },
      { onConflict: 'page_id,entity_id,block_path' }
    )
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

export async function unlinkPageFromEntity(linkId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('page_entity_links').delete().eq('id', linkId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

// The core "something changed" action — sets changed_at/change_note so every
// linked page immediately computes as "needs attention" (status != 'ok' OR
// entity.changed_at > reviewed_at), then fans out an AI audit job for every
// media/both-kind link (text-only links have nothing for Gemini to visually
// compare) so those verdicts get upgraded from "needs review" to an actual
// ok/stale/gap classification without a human opening every page.
export async function markEntityChanged(entityId: string, changeNote: string, newReferenceImageUrl?: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_entities')
    .update({
      changed_at: new Date().toISOString(),
      change_note: changeNote.trim() || null,
      ...(newReferenceImageUrl !== undefined && { reference_image_url: newReferenceImageUrl.trim() || null }),
    })
    .eq('id', entityId)
  if (error) throw new Error(error.message)

  const { data: links } = await supabase
    .from('page_entity_links')
    .select('page_id')
    .eq('entity_id', entityId)
    .in('kind', ['media', 'both'])
  if (links?.length) {
    await supabase.from('entity_audit_jobs').insert(links.map((l) => ({ entity_id: entityId, page_id: l.page_id })))
    await triggerAuditWorker()
  }

  revalidatePath('/admin/graph')
}

// The human "I checked this, here's the verdict" action.
export async function reviewLink(linkId: string, status: EntityLinkStatus, note?: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('page_entity_links')
    .update({ status, note: note?.trim() || null, reviewed_at: new Date().toISOString(), source: 'manual' })
    .eq('id', linkId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/graph')
}

// Shared by both worker triggers below — fire-and-forget POST, self-chains
// on its own (same pattern as translations/actions.ts's triggerWorker()).
async function kickWorker(path: string) {
  const secret = process.env.GRAPH_WORKER_SECRET
  if (!secret) return
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return
  try {
    await fetch(`${proto}://${host}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // fire-and-forget — worker keeps draining on its own self-chain regardless
  }
}

// Kick the link-extraction worker.
export async function triggerGraphSync() {
  await kickWorker('/api/graph/extract-worker')
  revalidatePath('/admin/graph')
}

// Kick the AI stale/gap audit worker.
export async function triggerAuditWorker() {
  await kickWorker('/api/graph/audit-worker')
}

// Manual-trigger-only (no publish-time auto-fan-out like graph_extract_jobs)
// — auto-populating links a human never asked for is worse than a graph
// that's merely incomplete until someone clicks this. Fans out one job per
// published document page in the project; each job checks that page against
// every entity in one Gemini call.
export async function suggestEntityLinksForProject(projectId: string) {
  const supabase = await createClient()
  const { data: pages } = await supabase
    .from('pages')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', 'document')
    .eq('status', 'published')
  if (pages?.length) {
    await supabase.from('entity_suggest_jobs').upsert(
      pages.map((p) => ({ page_id: p.id })),
      { onConflict: 'page_id', ignoreDuplicates: true }
    )
    await kickWorker('/api/graph/suggest-worker')
  }
  revalidatePath('/admin/graph')
}
