'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncProject, type SyncResult } from '@/lib/sync/github'

// Link (or change) the GitHub repo a project syncs from. RLS's
// projects_owner_all policy is what actually enforces ownership here — this
// runs as the caller's session, not service-role.
export async function connectGithubRepo(projectId: string, repo: string, branch: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('projects')
    .update({ github_repo: repo.trim(), github_branch: branch.trim() || 'main', github_last_synced_sha: null })
    .eq('id', projectId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/projects/[slug]', 'page')
}

// Ownership check shared by every action below. syncProject() and writes to
// github_sync_events run on the service-role client (bypasses RLS, same as
// the translation worker and the GitBook importer), so authorization has to
// happen here first — the same pattern app/api/admin/import-gitbook uses
// (`.eq('user_id', user.id)` on the lookup, not a separate policy check).
async function requireProjectOwner(projectId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not authorized')
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!project) throw new Error('not authorized')
}

// Trigger a sync directly (the manual "Sync from GitHub" button).
export async function runGithubSync(projectId: string): Promise<SyncResult> {
  await requireProjectOwner(projectId)
  const result = await syncProject(projectId)
  revalidatePath('/admin/projects/[slug]', 'page')
  return result
}

// "Review & Sync" on a webhook-detected pending notification: same sync, then
// marks that notification resolved.
export async function approveSyncEvent(projectId: string, eventId: string): Promise<SyncResult> {
  await requireProjectOwner(projectId)
  const result = await syncProject(projectId)
  const sb = createServiceClient()
  await sb
    .from('github_sync_events')
    .update({ status: 'synced', synced_at: new Date().toISOString() })
    .eq('id', eventId)
  revalidatePath('/admin/projects/[slug]', 'page')
  return result
}

// Dismiss a pending notification without syncing (e.g. "not ready yet").
export async function dismissSyncEvent(projectId: string, eventId: string): Promise<void> {
  await requireProjectOwner(projectId)
  const sb = createServiceClient()
  const { error } = await sb.from('github_sync_events').update({ status: 'dismissed' }).eq('id', eventId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/projects/[slug]', 'page')
}
