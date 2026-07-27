import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { drainTranslationJobs } from '@/lib/translation/run-jobs'

export const runtime = 'nodejs'
// Vercel caps function duration at 60s (Hobby) / 300s (Pro). We drain within a
// budget below this and self-chain for any remainder, so the worker is safe on
// either tier.
export const maxDuration = 300

// Stay safely under the Hobby 60s ceiling. The drain checks this deadline per
// job, so the worst-case overrun is one (possibly large) job — 35s leaves room
// for it to finish under 60s. On Vercel Pro (300s) there's ample headroom.
const TIME_BUDGET_MS = 35_000

// Background worker that drains the translation job queue. Invoked on-demand by
// the admin console / publish flow, and optionally by Supabase pg_cron.
// Authenticated by a shared secret — never user sessions.
function authorized(request: NextRequest): boolean {
  const secret = process.env.TRANSLATION_WORKER_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

// Fire a fresh worker invocation to continue draining a backlog, without waiting
// for it to finish (this request is already returning).
function selfTrigger(origin: string, secret: string) {
  // Intentionally not awaited; abort the client side quickly once the new
  // serverless invocation has been kicked off.
  fetch(`${origin}/api/translation/worker`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(2000),
  }).catch(() => {})
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const result = await drainTranslationJobs(db, {
    deadlineMs: Date.now() + TIME_BUDGET_MS,
  })

  // Backlog left over (we hit the time budget): kick a fresh invocation so the
  // queue keeps draining without relying on the cron.
  if (result.remaining) {
    const origin = new URL(request.url).origin
    selfTrigger(origin, process.env.TRANSLATION_WORKER_SECRET!)
  }

  return NextResponse.json(result)
}

// pg_cron/pg_net and the app POST; allow GET for manual checks.
export const POST = handle
export const GET = handle
