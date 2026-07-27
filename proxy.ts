import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { localeFromPathname, resolveLocale } from '@/lib/i18n/negotiate'

const LOCALE_COOKIE = 'NEXT_LOCALE'

// Paths that participate in locale routing (the public docs surface + home).
// Admin, auth, and api are single-language and skip locale handling.
function isLocalizedPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/docs' || pathname.startsWith('/docs/')
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // 1. Locale routing for the public docs. A locale-less docs path is redirected
  // to the visitor's resolved locale; a locale-prefixed path flows through with
  // an x-locale header so the root layout can set <html lang dir>.
  const pathLocale = localeFromPathname(pathname)

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

  // Forward the active locale to server components via a request header.
  const requestHeaders = new Headers(request.headers)
  if (pathLocale) requestHeaders.set('x-locale', pathLocale)

  let response = NextResponse.next({ request: { headers: requestHeaders } })

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
