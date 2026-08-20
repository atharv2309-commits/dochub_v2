import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { localeFromPathname, resolveLocale } from '@/lib/i18n/negotiate'
import { projectSlugForHost } from '@/lib/site'

const LOCALE_COOKIE = 'NEXT_LOCALE'

// Paths that participate in locale routing (the public docs surface + home).
// Admin, auth, and api are single-language and skip locale handling.
function isLocalizedPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    pathname === '/releases' ||
    pathname.startsWith('/releases/')
  )
}

// Short, memorable top-level aliases for the two projects, rewritten (not
// redirected) so the address bar keeps showing the short URL. "/releases"
// isn't used anywhere else, so it's a full-subtree alias; bare "/docs" (no
// further segment) is unused today too — "/docs/<projectSlug>/..." keeps
// working exactly as before since this only matches the bare case.
function resolveAlias(unprefixed: string): string | null {
  const releasesMatch = unprefixed.match(/^\/releases(\/.*)?$/)
  if (releasesMatch) return `/docs/flytbase-releases${releasesMatch[1] ?? ''}`
  if (unprefixed === '/docs') return '/docs/flytbase-docs'
  return null
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const pathLocale = localeFromPathname(pathname)
  // Normalized path with any locale prefix stripped, so domain scoping works
  // whether the request already has /{lang} on it or not.
  const unprefixed = pathLocale ? pathname.slice(1 + pathLocale.length) || '/' : pathname

  // Resolve /docs and /releases aliases to their canonical /docs/<slug> path.
  // Everything below keeps operating on the alias (pathname/unprefixed) for
  // locale redirects — the browser should keep seeing the short URL — and
  // only switches to the canonical path at the very end, via rewrite.
  const canonicalUnprefixed = resolveAlias(unprefixed) ?? unprefixed
  const aliased = canonicalUnprefixed !== unprefixed

  // 0. Domain scoping. When this Host is bound to one project (see
  // DOMAIN_PROJECT_MAP in lib/site.ts), the public docs surface only ever
  // serves that project — requesting a different project's slug 404s instead
  // of silently serving it (both projects live in the same Supabase project).
  const host = request.headers.get('host')
  const mappedSlug = host ? projectSlugForHost(host) : null
  if (mappedSlug && isLocalizedPath(unprefixed)) {
    const pathSlug = canonicalUnprefixed.match(/^\/docs\/([^/]+)/)?.[1]
    if (pathSlug && pathSlug !== mappedSlug) {
      return new NextResponse(null, { status: 404 })
    }
  }

  // 1. Locale routing for the public docs. A locale-less docs path is redirected
  // to the visitor's resolved locale; a locale-prefixed path flows through with
  // an x-locale header so the root layout can set <html lang dir>.
  if (!pathLocale && isLocalizedPath(pathname)) {
    const locale = resolveLocale({
      pathname,
      cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    })
    const url = request.nextUrl.clone()
    url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`
    const redirect = NextResponse.redirect(url)
    redirect.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    return redirect
  }

  // Forward the active locale and domain-pinned project to server components.
  const requestHeaders = new Headers(request.headers)
  if (pathLocale) requestHeaders.set('x-locale', pathLocale)
  if (mappedSlug) requestHeaders.set('x-project-slug', mappedSlug)

  // Aliased request ("/releases/...", bare "/docs") — rewrite to the real
  // canonical route internally while the browser keeps the short URL.
  const response = aliased
    ? NextResponse.rewrite(
        new URL(`/${pathLocale}${canonicalUnprefixed}`, request.url),
        { request: { headers: requestHeaders } }
      )
    : NextResponse.next({ request: { headers: requestHeaders } })

  // 2. Supabase session refresh + admin auth gate (unchanged behaviour).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || supabaseUrl === 'your_supabase_url' || !supabaseKey) {
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }))
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // Refresh session — must use getClaims() not getSession()
  const { data } = await supabase.auth.getClaims()

  // Only the admin app is auth-gated. Home (/) and /docs are public.
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  if (isAdminRoute && !data?.claims) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Run on app routes; skip Next internals, auth pages, the upload API, and
    // static asset files. /docs now flows through for locale handling.
    '/((?!_next/static|_next/image|favicon.ico|auth|api/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
