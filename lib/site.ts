import { headers } from 'next/headers'

// Absolute site origin for SEO (sitemap, canonical, OG). Set NEXT_PUBLIC_SITE_URL
// in production (e.g. https://docs.yourcompany.com). Used as the fallback for
// any project that isn't bound to its own domain below.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

// Multiple projects, one Supabase project, each optionally bound to its own
// domain: DOMAIN_PROJECT_MAP='{"docs.flytbase.com":"flytbase-docs","releases.flytbase.com":"flytbase-releases"}'.
// Kept as an env var (not a DB column) deliberately — proxy.ts reads this on
// every request and Next's own guidance is that proxy shouldn't do slow data
// fetching, so domain routing needs to be a zero-latency in-memory lookup.
function domainMap(): Record<string, string> {
  try {
    return JSON.parse(process.env.DOMAIN_PROJECT_MAP ?? '{}')
  } catch {
    return {}
  }
}

// The project slug this host is bound to, or null if unmapped (local dev,
// preview deployments, or a project with no custom domain yet).
export function projectSlugForHost(host: string): string | null {
  return domainMap()[host] ?? null
}

// Canonical origin for `slug`'s project: its own custom domain if one maps to
// it, else the shared SITE_URL. Use this (not the bare SITE_URL) for anything
// that varies per project — canonical/OG/hreflang URLs, MCP citation links.
export function siteUrlForProject(slug: string): string {
  const host = Object.entries(domainMap()).find(([, s]) => s === slug)?.[0]
  return host ? `https://${host}` : SITE_URL
}

// The current request's own origin, for host-scoped routes with no project
// slug in the URL to key off (sitemap.xml, robots.txt).
export async function currentSiteUrl(): Promise<string> {
  const host = (await headers()).get('host')
  if (host && domainMap()[host]) return `https://${host}`
  return SITE_URL
}
