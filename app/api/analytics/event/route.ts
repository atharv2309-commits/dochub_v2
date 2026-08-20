import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'
import { rateLimit, clientIp } from '@/lib/mcp/rate-limit'
import type { PageEventType } from '@/types/db'

const EVENT_TYPES: PageEventType[] = [
  'search_query',
  'search_zero_result',
  'pdf_download',
  'copy_page',
  'view_markdown',
  'open_chatgpt',
  'open_claude',
  'mcp_connect_click',
  'feedback',
]

// Fire-and-forget analytics beacon. Uses the anon client — RLS already enforces
// that inserts only succeed for public projects, so this route does no
// authorization of its own. Always best-effort: a rejected/invalid event never
// surfaces as a hard error to the caller (trackEvent() ignores the response).
export async function POST(request: Request) {
  const { ok } = rateLimit(`analytics-event:${clientIp(request)}`, { capacity: 40, refillPerSec: 1 })
  if (!ok) return NextResponse.json({ ok: false }, { status: 429 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const eventType = body.eventType as PageEventType
  const projectId = body.projectId as string
  if (typeof projectId !== 'string' || !projectId || !EVENT_TYPES.includes(eventType)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const supabase = createAnonClient()
  const { error } = await supabase.from('page_events').insert({
    project_id: projectId,
    event_type: eventType,
    page_id: typeof body.pageId === 'string' ? body.pageId : null,
    locale: typeof body.locale === 'string' ? body.locale : null,
    query_text: typeof body.queryText === 'string' ? body.queryText : null,
    helpful: typeof body.helpful === 'boolean' ? body.helpful : null,
    comment: typeof body.comment === 'string' ? body.comment : null,
  })

  // RLS rejects private/nonexistent projects — expected, not a server error.
  return NextResponse.json({ ok: !error })
}
