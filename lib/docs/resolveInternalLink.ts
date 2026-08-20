import { SITE_URL, siteUrlForProject } from '@/lib/site'
import { isLocale } from '@/lib/i18n/config'

// Same shape as the equivalent resolver in lib/graph/extractPageLinks.ts
// (kept as an independent, DB-free copy on purpose — that module is
// admin/write-scoped with a service-role SupabaseClient; this one backs a
// PUBLIC read route and must never be coupled to that trust boundary).
// Recognizes: this deployment's canonical /{locale}/docs/{projectSlug}/{path}
// form, the /docs and /releases short aliases from proxy.ts, and the legacy
// GitBook domain (docs.flytbase.com) most already-imported content still
// links to (one space = one domain there, so a bare {origin}/{path} always
// means flytbase-docs).
const LEGACY_DOCS_ORIGIN = 'https://docs.flytbase.com'
const LEGACY_DOCS_SLUG = 'flytbase-docs'

export function resolveInternalLink(href: string, knownOrigins: Set<string>): { projectSlug: string; path: string } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  if (url.origin === LEGACY_DOCS_ORIGIN) {
    const path = url.pathname.split('/').filter(Boolean).join('/')
    return path ? { projectSlug: LEGACY_DOCS_SLUG, path } : null
  }
  if (!knownOrigins.has(url.origin)) return null

  const parts = url.pathname.split('/').filter(Boolean)

  if (parts[0] === 'releases') {
    const path = parts.slice(1).join('/')
    return path ? { projectSlug: 'flytbase-releases', path } : null
  }
  if (parts.length >= 2 && isLocale(parts[0]) && parts[1] === 'releases') {
    const path = parts.slice(2).join('/')
    return path ? { projectSlug: 'flytbase-releases', path } : null
  }

  let i = 0
  if (isLocale(parts[i])) i++
  if (parts[i] === 'docs' && parts[i + 1]) {
    const path = parts.slice(i + 2).join('/')
    return path ? { projectSlug: parts[i + 1], path } : null
  }
  return null
}

// Every origin this deployment answers to — project custom domains plus the
// shared SITE_URL fallback. Cheap to recompute per request; no DB involved.
export function knownOriginsFor(projectSlugs: string[]): Set<string> {
  const origins = new Set<string>([new URL(SITE_URL).origin])
  for (const slug of projectSlugs) origins.add(new URL(siteUrlForProject(slug)).origin)
  return origins
}
