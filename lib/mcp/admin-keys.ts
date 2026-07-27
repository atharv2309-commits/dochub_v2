import 'server-only'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { hashKey, ADMIN_KEY_PREFIX } from './keys'

// Server-only management of admin MCP API keys, backing the /admin/mcp page.
// Keys are minted here (raw value returned ONCE), stored as a SHA-256 hash, and
// revoked by stamping revoked_at. All calls use the service client and must be
// invoked behind the admin-auth guard in the page's server actions.

export interface AdminKeyRow {
  id: string
  label: string | null
  key_prefix: string | null
  scopes: string[] | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

type AnyClient = {
  from: (t: string) => {
    select: (c: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: AdminKeyRow[] | null; error: { message: string } | null }> }
    insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    update: (v: Record<string, unknown>) => { eq: (c: string, val: string) => Promise<{ error: { message: string } | null }> }
  }
}

/** List all keys (active + revoked), newest first. Throws if the table is absent. */
export async function listKeys(): Promise<AdminKeyRow[]> {
  const sb = createServiceClient() as unknown as AnyClient
  const { data, error } = await sb
    .from('mcp_api_keys')
    .select('id,label,key_prefix,scopes,created_at,last_used_at,revoked_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Mint a new admin key. Returns the raw secret — shown to the user exactly once. */
export async function createKey(label: string): Promise<string> {
  const raw = `${ADMIN_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  const sb = createServiceClient() as unknown as AnyClient
  const { error } = await sb.from('mcp_api_keys').insert({
    label: label.trim() || 'admin',
    key_prefix: raw.slice(0, 12),
    key_hash: hashKey(raw),
    scopes: ['admin'],
  })
  if (error) throw new Error(error.message)
  return raw
}

/** Revoke a key by id (keeps the row for audit; verifyAdminKey rejects revoked). */
export async function revokeKey(id: string): Promise<void> {
  const sb = createServiceClient() as unknown as AnyClient
  const { error } = await sb
    .from('mcp_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
