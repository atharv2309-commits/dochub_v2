'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

// Thin server action holding ANALYTICS_WORKER_SECRET server-side, mirroring
// translations/actions.ts's triggerWorker() pattern. Unlike that fire-and-forget
// trigger, we await the response here — generate-insights is a single bounded
// request (not a self-chaining drain), and the button wants fresh data once it
// resolves.
export async function generateInsights(projectId?: string) {
  const secret = process.env.ANALYTICS_WORKER_SECRET
  if (!secret) return
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return
  try {
    await fetch(`${proto}://${host}/api/analytics/generate-insights`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(projectId ? { projectId } : {}),
    })
  } catch {
    // Best-effort — the admin page just won't show a fresh digest this time.
  }
  revalidatePath('/admin/analytics')
}
