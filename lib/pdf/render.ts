import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import type { Browser } from 'puppeteer-core'

// Launch Chromium the right way per environment:
// - On Vercel/serverless: puppeteer-core + @sparticuz/chromium's Lambda binary
//   (small, read-only-fs friendly — bundled full puppeteer would not run there).
// - Locally: full puppeteer with its own bundled Chrome (zero setup for dev).
// Both packages are externalized in next.config so neither is bundled.
// Puppeteer's own CDP round-trip timeout (default 180s), separate from page
// navigation — the whole-project route's "wait for every image to decode"
// step is a single page.evaluate() call that can outlast that default on a
// large document, so it needs its own generous budget.
const PROTOCOL_TIMEOUT_MS = 240_000

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
      protocolTimeout: PROTOCOL_TIMEOUT_MS,
    })
  }
  // Dev: full puppeteer. Cast bridges puppeteer's Browser to puppeteer-core's
  // (puppeteer re-exports the same types, but the dynamic import widens them).
  const puppeteer = await import('puppeteer')
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
  }) as unknown as Browser
}

// Render any /print route with headless Chromium and return it as a PDF
// download response. Shared by the single-page and whole-project PDF routes —
// reuses the site's real rendering (tables, code, images, callouts, columns)
// rather than re-implementing layout.
export async function renderPrintUrlToPdf(
  printUrl: string,
  filename: string,
  opts: { navigationTimeoutMs?: number } = {}
): Promise<NextResponse> {
  const logoBase64 = readFileSync(join(process.cwd(), 'public', 'flytbase-icon.png')).toString('base64')

  let browser: Browser | undefined
  try {
    browser = await launchBrowser()

    const page = await browser.newPage()
    // Tall viewport so the full document is "on screen" — keeps any remaining
    // viewport-dependent loading from skipping below-the-fold content.
    await page.setViewport({ width: 1200, height: 2400, deviceScaleFactor: 2 })
    const res = await page.goto(printUrl, {
      waitUntil: 'networkidle0',
      timeout: opts.navigationTimeoutMs ?? 90_000,
    })
    if (!res || !res.ok()) {
      return NextResponse.json({ error: 'page not found or not published' }, { status: 404 })
    }
    // Ensure web fonts are ready before snapshotting.
    await page.evaluateHandle('document.fonts.ready')
    // Explicitly wait for every image to finish loading/decoding. networkidle0
    // alone can race with image decode, and any lazy <img> needs forcing. A
    // hot-linked fallback URL (oversized assets the sync couldn't re-host)
    // can hang forever without ever firing load or error — so each image
    // gets its own bounded wait rather than blocking the whole document on one.
    await page.evaluate(async () => {
      const PER_IMAGE_TIMEOUT_MS = 10_000
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
                const done = () => resolve()
                img.addEventListener('load', done, { once: true })
                img.addEventListener('error', done, { once: true })
                setTimeout(done, PER_IMAGE_TIMEOUT_MS)
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

// Resolve the deployment's own public origin so headless Chromium can fetch
// the /print route. Behind Vercel's edge, the forwarded headers carry the
// real https host; fall back to the raw request URL for local dev.
export function resolveOrigin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return host ? `${proto}://${host}` : new URL(request.url).origin
}
