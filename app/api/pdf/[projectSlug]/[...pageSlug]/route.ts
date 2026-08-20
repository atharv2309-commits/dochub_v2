import { type NextRequest } from 'next/server'
import { renderPrintUrlToPdf, resolveOrigin } from '@/lib/pdf/render'

export const runtime = 'nodejs'
// Vercel caps function duration at 60s (Hobby) / 300s (Pro). 60 is universally
// safe — a single page renders in a few seconds even with Chromium cold start.
export const maxDuration = 60

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectSlug: string; pageSlug: string[] }> }
) {
  const { projectSlug, pageSlug } = await params
  const path = pageSlug.join('/')
  const lang = new URL(request.url).searchParams.get('lang') || undefined
  const printUrl = `${resolveOrigin(request)}/print/${projectSlug}/${encodeURI(path)}${lang ? `?lang=${lang}` : ''}`
  const filename = (pageSlug[pageSlug.length - 1] || 'document').replace(/[^a-z0-9-]/gi, '-')

  return renderPrintUrlToPdf(printUrl, filename)
}
