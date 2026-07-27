import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Service-role client for trusted server-only work (the translation worker).
// Bypasses RLS, so it must NEVER be imported into client or public-request code
// paths — only background jobs authenticated by a separate secret.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
