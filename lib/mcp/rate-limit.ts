// Lightweight in-memory token-bucket rate limiter for the MCP endpoints.
//
// This is a best-effort guard against simple abuse/DoS of the ANONYMOUS public
// endpoint (and unauthenticated hammering of the admin auth check). It is
// per-instance: in a multi-instance serverless deployment each instance keeps its
// own buckets, so it bounds per-instance load but is not a global quota. For
// production-grade distributed limiting put a WAF / edge rate limit (Vercel WAF,
// Upstash Ratelimit) in front — this is the in-app backstop.

interface Bucket {
  tokens: number
  updated: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

export interface RateLimitOptions {
  /** Max burst (bucket capacity). */
  capacity: number
  /** Sustained refill rate, tokens per second. */
  refillPerSec: number
}

export function rateLimit(
  key: string,
  opts: RateLimitOptions
): { ok: boolean; retryAfter: number } {
  const now = Date.now()
  // Opportunistic prune so the map can't grow unbounded under key churn.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (now - b.updated > 60_000) buckets.delete(k)
    }
  }
  const b = buckets.get(key) ?? { tokens: opts.capacity, updated: now }
  const elapsed = (now - b.updated) / 1000
  b.tokens = Math.min(opts.capacity, b.tokens + elapsed * opts.refillPerSec)
  b.updated = now
  if (b.tokens < 1) {
    buckets.set(key, b)
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / opts.refillPerSec) }
  }
  b.tokens -= 1
  buckets.set(key, b)
  return { ok: true, retryAfter: 0 }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

type Handler = (req: Request) => Response | Promise<Response>

/** Wrap an MCP handler with per-key token-bucket rate limiting (429 on excess). */
export function withRateLimit(
  handler: Handler,
  opts: RateLimitOptions & { keyFn: (req: Request) => string }
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const { ok, retryAfter } = rateLimit(opts.keyFn(req), opts)
    if (!ok) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32029, message: 'Rate limit exceeded. Slow down and retry.' },
          id: null,
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': String(retryAfter) },
        }
      )
    }
    return handler(req)
  }
}
