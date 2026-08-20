'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// Update which non-source locales a project publishes.
export async function setProjectLocales(projectId: string, locales: string[]) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('projects')
    .update({ enabled_locales: locales })
    .eq('id', projectId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/translations')
}

// Queue (re)translation for a project across the given locales. onlyStale=true
// queues just missing/outdated pages; false re-translates everything.
// Requesting a locale also "enables" it for the project (so it shows in the
// public switcher and stays in sync on future publishes) — enabling is implicit,
// there's no separate selection step.
export async function requestTranslations(
  projectId: string,
  locales: string[],
  onlyStale = false
) {
  const supabase = await createClient()

  const { data: proj } = await supabase
    .from('projects')
    .select('enabled_locales')
    .eq('id', projectId)
    .single()
  const current = proj?.enabled_locales ?? []
  const merged = Array.from(new Set([...current, ...locales]))
  if (merged.length !== current.length) {
    await supabase.from('projects').update({ enabled_locales: merged }).eq('id', projectId)
  }

  const { error } = await supabase.rpc('request_translations', {
    p_project_id: projectId,
    p_locales: locales,
    p_only_stale: onlyStale,
  })
  if (error) throw new Error(error.message)
  // Kick the worker so the user sees progress without waiting for the cron tick.
  await triggerWorker()
  revalidatePath('/admin/translations')
}

// Queue (re)translation for a single page across the given locales. Used by the
// per-page translation widget in the editor.
export async function requestPageTranslation(pageId: string, locales: string[]) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('request_page_translations', {
    p_page_id: pageId,
    p_locales: locales,
  })
  if (error) throw new Error(error.message)
  await triggerWorker()
}

// Human sign-off toggle on a single translation.
export async function setReviewed(pageId: string, locale: string, reviewed: boolean) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_translation_reviewed', {
    p_page_id: pageId,
    p_locale: locale,
    p_reviewed: reviewed,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/translations')
}

// Kick the background worker (fire-and-forget). We only need to START a worker
// invocation here; it drains the queue (and self-chains for any backlog) on its
// own. We abort the client side after a short window so callers aren't blocked
// by the full translation run. Best-effort — a miss just means the next trigger
// or the optional cron picks the jobs up.
export async function triggerWorker() {
  const secret = process.env.TRANSLATION_WORKER_SECRET
  if (!secret) return
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return
  try {
    await fetch(`${proto}://${host}/api/translation/worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    // Expected: we abort once the worker invocation is kicked off.
  }
}

// Called after a page is published so its freshly-enqueued translation jobs
// start processing immediately instead of waiting for the next cron tick.
export async function notifyPagePublished() {
  await triggerWorker()
}

// Do-not-translate glossary (platform UI terms like "Operations Dashboard").
// Self-serve: any authenticated admin manages the shared list, no code change
// needed. New/edited terms only affect translations run after they're added —
// existing cached translation_memory entries aren't retroactively fixed.
export async function addGlossaryTerm(term: string, notes: string) {
  const trimmed = term.trim()
  if (!trimmed) throw new Error('term is required')
  const supabase = await createClient()
  const { error } = await supabase
    .from('translation_glossary')
    .insert({ term: trimmed, notes: notes.trim() || null })
  if (error) throw new Error(error.message.includes('unique') ? 'That term is already in the glossary.' : error.message)
  revalidatePath('/admin/translations')
}

export async function deleteGlossaryTerm(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('translation_glossary').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/translations')
}
