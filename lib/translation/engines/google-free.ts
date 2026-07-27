import { translate } from 'google-translate-api-x'
import type { TranslationEngine, TranslateOptions } from '../engine'

// Free Google Translate engine via google-translate-api-x — a maintained fork
// that stays working against Google's web endpoint where other unofficial
// clients (e.g. @vitalets) currently break ("Invalid response body").
//
// It accepts an array of strings and returns an array of translations in one
// call, so we batch — fewer requests means faster runs and far less throttling.
// Because the pipeline only ever sends cache-MISSED segments (translation memory
// serves the rest), real request volume stays low.
//
// To swap engines, implement TranslationEngine elsewhere and register it in
// ../registry.ts — nothing else in the codebase references this file.

const CHUNK = 40 // segments per request — keeps the request URL within limits
const DELAY_MS = 200 // gentle spacing between chunks
const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 30_000 // cap a single request so a stalled endpoint can't hang a job

// Map our internal locale codes to the codes google-translate-api-x expects.
// Our routes/DB use "zh", but the engine only knows "zh-CN"/"zh-TW". Storage and
// URLs stay on our code; only the outbound engine call is remapped.
const ENGINE_CODE: Record<string, string> = {
  zh: 'zh-CN',
}
const toEngineCode = (code: string) => ENGINE_CODE[code] ?? code

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Reject if `promise` doesn't settle within `ms`, so a hung network call surfaces
// as a normal (retryable) error instead of stalling the worker/script forever.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('translate request timed out')), ms)),
  ])
}

async function translateChunk(texts: string[], opts: TranslateOptions): Promise<string[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        translate(texts, {
          from: toEngineCode(opts.from),
          to: toEngineCode(opts.to),
          forceBatch: true,
          forceTo: true, // pass through codes the lib doesn't pre-validate
        }),
        REQUEST_TIMEOUT_MS
      )
      // Array input yields an array result, element-aligned with the input.
      return (res as { text: string }[]).map((r) => r.text)
    } catch (err) {
      lastErr = err
      // Exponential backoff — the endpoint throttles under sustained load.
      await sleep(DELAY_MS * Math.pow(3, attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('translation failed')
}

export const googleFreeEngine: TranslationEngine = {
  id: 'google-free',
  async translateBatch(texts, opts) {
    const out: string[] = []
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK)
      out.push(...(await translateChunk(chunk, opts)))
      if (i + CHUNK < texts.length) await sleep(DELAY_MS)
    }
    return out
  },
}
