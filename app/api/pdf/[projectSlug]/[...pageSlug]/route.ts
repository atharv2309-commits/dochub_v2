import { type NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from 'puppeteer-core'

export const runtime = 'nodejs'
// Vercel caps function duration at 60s (Hobby) / 300s (Pro). 60 is universally
// safe — a large doc renders in a few seconds even with Chromium cold start.
export const maxDuration = 60

// Launch Chromium the right way per environment:
// - On Vercel/serverless: puppeteer-core + @sparticuz/chromium's Lambda binary
//   (small, read-only-fs friendly — bundled full puppeteer would not run there).
// - Locally: full puppeteer with its own bundled Chrome (zero setup for dev).
// Both packages are externalized in next.config so neither is bundled.
async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default
    const puppeteer = await import('puppeteer-core')
    // We render text/images, not WebGL — skip SwiftShader extraction for a
    // faster cold start and lower memory footprint.
    chromium.setGraphicsMode = false
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  // Dev: full puppeteer. Cast bridges puppeteer's Browser to puppeteer-core's
  // (puppeteer re-exports the same types, but the dynamic import widens them).
  const puppeteer = await import('puppeteer')
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }) as unknown as Browser
}

// Render the branded /print view with headless Chromium and return a PDF.
// Reuses the site's real rendering (tables, code, images, callouts, columns)
// for full fidelity rather than re-implementing layout.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectSlug: string; pageSlug: string[] }> }
) {
  const { projectSlug, pageSlug } = await params
  const path = pageSlug.join('/')
  // Resolve the deployment's own public origin so headless Chromium can fetch
  // the /print route. Behind Vercel's edge, the forwarded headers carry the
  // real https host; fall back to the raw request URL for local dev.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin
  const printUrl = `${origin}/print/${projectSlug}/${encodeURI(path)}`
  const filename = (pageSlug[pageSlug.length - 1] || 'document').replace(/[^a-z0-9-]/gi, '-')

  const logoBase64 = readFileSync(join(process.cwd(), 'public', 'flytbase-icon.png')).toString('base64')

  let browser: Browser | undefined
  try {
    browser = await launchBrowser()

    const page = await browser.newPage()
    // Tall viewport so the full document is "on screen" — keeps any remaining
    // viewport-dependent loading from skipping below-the-fold content.
    await page.setViewport({ width: 1200, height: 2400, deviceScaleFactor: 2 })
    // Forward auth/session cookies so non-public projects could be supported later.
    const res = await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 90_000 })
    if (!res || !res.ok()) {
      return NextResponse.json({ error: 'page not found or not published' }, { status: 404 })
    }
    // Ensure web fonts are ready before snapshotting.
    await page.evaluateHandle('document.fonts.ready')
    // Explicitly wait for every image to finish loading/decoding. networkidle0
    // alone can race with image decode, and any lazy <img> needs forcing.
    await page.evaluate(async () => {
      const imgs = Array.from(document.images)
      imgs.forEach((img) => {
        img.loading = 'eager'
        if (!img.complete) img.src = img.src // re-trigger fetch for deferred loads
      })
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true })
                img.addEventListener('error', () => resolve(), { once: true })
              })
        )
      )
    })

    const headerTemplate = `
      <div style="font-size:8px; width:100%; padding:4px 48px 0; display:flex; align-items:center; color:#9ca3af; font-family: Arial, sans-serif;">
        <img src="data:image/png;base64,${logoBase64}" style="height:13px; width:13px; margin-right:6px;" />
        <span>FlytBase Documentation</span>
      </div>`
    const footerTemplate = `
      <div style="font-size:8px; width:100%; padding:0 48px 4px; text-align:center; color:#9ca3af; font-family: Arial, sans-serif;">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span> &nbsp;·&nbsp; © FlytBase
      </div>`

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: '64px', bottom: '56px', left: '0', right: '0' },
      headerTemplate,
      footerTemplate,
    })

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('PDF generation failed:', err)
    return NextResponse.json({ error: 'failed to generate PDF' }, { status: 500 })
  } finally {
    if (browser) await browser.close()
  }
}
