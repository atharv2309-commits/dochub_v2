'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createKey, revokeKey } from '@/lib/mcp/admin-keys'

// Admin-only server actions for MCP key management. The /admin segment is already
// gated by proxy.ts, but we re-check the session here so these privileged actions
// can never run unauthenticated even if called directly.
async function assertAdmin() {
  const sb = await createClient()
  const { data } = await sb.auth.getClaims()
  if (!data?.claims) throw new Error('Not authenticated')
}

export async function generateKeyAction(label: string): Promise<string> {
  await assertAdmin()
  const raw = await createKey(label)
  revalidatePath('/admin/mcp')
  return raw
}

export async function revokeKeyAction(id: string): Promise<void> {
  await assertAdmin()
  await revokeKey(id)
  revalidatePath('/admin/mcp')
}
