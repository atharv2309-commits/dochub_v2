import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Anonymous Supabase client (publishable key, no cookies, no session).
 *
 * Used by the PUBLIC MCP server for all reads. Because it runs as the `anon`
 * role, RLS guarantees it can only ever see published, non-hidden pages in
 * public projects — the read-only guarantee comes from the database, not just
 * from which tools we register. Safe to use in stateless route handlers.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not configured')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
