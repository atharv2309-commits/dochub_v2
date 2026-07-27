import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

// mcp_api_keys / mcp_audit_log aren't in the generated Database types yet (run
// `npm run db:types` after pushing the migration). Until then, reach them through
// a narrowly-typed view of the service client rather than leaking `any` widely.
type AnyClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        is: (c: string, v: null) => { maybeSingle: () => Promise<{ data: KeyRow | null; error: unknown }> }
      }
    }
    update: (vals: Record<string, unknown>) => { eq: (c: string, v: unknown) => Promise<{ error: unknown }> }
  }
}

interface KeyRow {
  id: string
  label: string | null
  scopes: string[] | null
  revoked_at: string | null
}

export interface AdminKeyInfo {
  keyId: string
  label: string | null
  scopes: string[]
}

export const ADMIN_KEY_PREFIX = 'dhk_' // DocHub Key

/** SHA-256 hex of a raw key. The DB only ever stores this, never the raw secret. */
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Verify an admin MCP bearer token against mcp_api_keys.
 *
 * Returns the key's scopes/identity on success, or null if the token is missing,
 * unknown, or revoked. High-entropy keys are looked up by their hash (an indexed
 * unique-equality match), so there's no plaintext comparison to time-attack. The
 * last_used_at touch is best-effort and never blocks auth.
 */
export async function verifyAdminKey(raw: string | undefined): Promise<AdminKeyInfo | null> {
  const token = raw?.trim()
  if (!token) return null

  const sb = createServiceClient() as unknown as AnyClient
  const { data, error } = await sb
    .from('mcp_api_keys')
    .select('id,label,scopes,revoked_at')
    .eq('key_hash', hashKey(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (error || !data) return null

  // Await so the timestamp reliably flushes before the serverless function may
  // freeze — last_used_at backs key-rotation/abuse forensics.
  await sb
    .from('mcp_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return { keyId: data.id, label: data.label, scopes: data.scopes ?? [] }
}
