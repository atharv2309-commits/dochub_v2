import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { drainEntitySuggestJobs } from '@/lib/graph/run-suggest-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

// Stay safely under the Hobby 60s ceiling — see translation/worker/route.ts,
// same reasoning, same budget.
const TIME_BUDGET_MS = 35_000

// Background worker that drains the AI entity-link suggestion queue. Fanned
// out by the "Suggest links" admin action. Same shared-secret trust boundary
// as the other graph workers — reuses GRAPH_WORKER_SECRET rather than a new one.
function authorized(request: NextRequest): boolean {
  const secret = process.env.GRAPH_WORKER_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

function selfTrigger(origin: string, secret: string) {
  fetch(`${origin}/api/graph/suggest-worker`, {
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
  const result = await drainEntitySuggestJobs(db, { deadlineMs: Date.now() + TIME_BUDGET_MS })

  if (result.remaining) {
    const origin = new URL(request.url).origin
    selfTrigger(origin, process.env.GRAPH_WORKER_SECRET!)
  }

  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
