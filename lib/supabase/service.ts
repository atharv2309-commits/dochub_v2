import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Service-role Supabase client — bypasses RLS. SERVER-ONLY.
 *
 * Used by the admin MCP server (after the request's API key is verified) to
 * perform writes and read unpublished content. Never import this into client
 * components or the public MCP server. No session is persisted: each call is a
 * stateless, fully-privileged request authenticated by the service key.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not configured')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
