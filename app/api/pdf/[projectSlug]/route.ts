import { type NextRequest } from 'next/server'
import { renderPrintUrlToPdf, resolveOrigin } from '@/lib/pdf/render'

export const runtime = 'nodejs'
// Whole-project PDFs can run to 100+ pages with images — needs real headroom.
// 300s is the Vercel Pro ceiling (same limit the translation worker route
// already assumes); Hobby-tier deployments will need to keep projects smaller
// or accept truncation at the platform's 60s cap.
export const maxDuration = 300

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await params
  const lang = new URL(request.url).searchParams.get('lang') || undefined
  const printUrl = `${resolveOrigin(request)}/print/${projectSlug}${lang ? `?lang=${lang}` : ''}`

  return renderPrintUrlToPdf(printUrl, `${projectSlug}-complete`, { navigationTimeoutMs: 180_000 })
}
