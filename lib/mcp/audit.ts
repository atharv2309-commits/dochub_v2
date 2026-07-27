import { createServiceClient } from '@/lib/supabase/service'

export interface AuditEntry {
  keyId?: string | null
  tool: string
  project?: string | null
  path?: string | null
  args?: unknown
  status?: 'ok' | 'error'
  error?: string | null
}

/**
 * Record an admin MCP action in mcp_audit_log. Best-effort: a logging failure
 * must never break or block the tool call itself, so all errors are swallowed.
 */
export async function logMcpAction(entry: AuditEntry): Promise<void> {
  try {
    const sb = createServiceClient() as unknown as {
      from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: unknown }> }
    }
    await sb.from('mcp_audit_log').insert({
      key_id: entry.keyId ?? null,
      tool: entry.tool,
      project_slug: entry.project ?? null,
      page_path: entry.path ?? null,
      args: entry.args ?? null,
      status: entry.status ?? 'ok',
      error: entry.error ?? null,
    })
  } catch {
    // swallow — audit logging is never allowed to fail a tool
  }
}
