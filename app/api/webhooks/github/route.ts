// GitHub webhook receiver — push events only. Verifies the signature, then
// just records a 'pending' row in github_sync_events for any project linked
// to that repo+branch; it never syncs by itself. An admin reviews the
// notification and clicks Sync (or dismisses it) — see
// app/(admin)/admin/projects/[slug]/actions.ts for the actual sync call.
//
// Auth: GitHub signs the raw body with GITHUB_WEBHOOK_SECRET
// (X-Hub-Signature-256, HMAC-SHA256) — the body must be read as raw text
// before parsing, or the signature check is meaningless.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

interface PushPayload {
  ref: string
  after: string
  repository: { full_name: string }
  commits?: { id: string; message: string; added?: string[]; removed?: string[]; modified?: string[] }[]
}

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })

  const rawBody = await request.text()
  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return NextResponse.json({ ok: true })
  if (event !== 'push') return NextResponse.json({ ok: true, ignored: event })

  const payload = JSON.parse(rawBody) as PushPayload
  const branch = payload.ref.replace(/^refs\/heads\//, '')
  const commits = payload.commits ?? []
  const changedFiles = new Set<string>()
  for (const c of commits) {
    for (const f of [...(c.added ?? []), ...(c.removed ?? []), ...(c.modified ?? [])]) changedFiles.add(f)
  }
  const summary = `${commits.length} commit${commits.length === 1 ? '' : 's'}, ${changedFiles.size} file${changedFiles.size === 1 ? '' : 's'} changed`

  const sb = createServiceClient()
  const { data: projects } = await sb
    .from('projects')
    .select('id')
    .eq('github_repo', payload.repository.full_name)
    .eq('github_branch', branch)
  if (!projects?.length) return NextResponse.json({ ok: true, matched: 0 })

  for (const project of projects) {
    const { data: pending } = await sb
      .from('github_sync_events')
      .select('id')
      .eq('project_id', project.id)
      .eq('status', 'pending')
      .maybeSingle()

    if (pending) {
      await sb
        .from('github_sync_events')
        .update({ commit_sha: payload.after, summary, detected_at: new Date().toISOString() })
        .eq('id', pending.id)
    } else {
      await sb
        .from('github_sync_events')
        .insert({ project_id: project.id, commit_sha: payload.after, summary, status: 'pending' })
    }
  }

  return NextResponse.json({ ok: true, matched: projects.length })
}
