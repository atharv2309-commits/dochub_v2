import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { drainGraphExtractJobs } from '@/lib/graph/run-extract-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

// Stay safely under the Hobby 60s ceiling — see translation/worker/route.ts,
// same reasoning, same budget.
const TIME_BUDGET_MS = 35_000

// Background worker that drains the page-link extraction queue. Invoked by
// the admin "Sync now" button. Authenticated by a shared secret — never user
// sessions.
function authorized(request: NextRequest): boolean {
  const secret = process.env.GRAPH_WORKER_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

function selfTrigger(origin: string, secret: string) {
  fetch(`${origin}/api/graph/extract-worker`, {
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
  const result = await drainGraphExtractJobs(db, { deadlineMs: Date.now() + TIME_BUDGET_MS })

  if (result.remaining) {
    const origin = new URL(request.url).origin
    selfTrigger(origin, process.env.GRAPH_WORKER_SECRET!)
  }

  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
