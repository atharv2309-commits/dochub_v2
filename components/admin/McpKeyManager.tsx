'use client'

import { useState, useTransition } from 'react'
import { Key, Trash2, Copy, Check, AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectOptions } from '@/components/mcp/ConnectOptions'
import type { AdminKeyRow } from '@/lib/mcp/admin-keys'
import { generateKeyAction, revokeKeyAction } from '@/app/(admin)/admin/mcp/actions'

function fmt(ts: string | null): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return '—'
  }
}

export function McpKeyManager({ keys, available }: { keys: AdminKeyRow[]; available: boolean }) {
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function generate() {
    setError(null)
    startTransition(async () => {
      try {
        const raw = await generateKeyAction(label)
        setNewKey(raw)
        setLabel('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create key')
      }
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      try {
        await revokeKeyAction(id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to revoke key')
      }
    })
  }

  if (!available) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="font-medium">Key management isn’t available yet</p>
          <p className="text-muted-foreground">
            Apply the MCP migration to the database (<code className="text-xs">npx supabase db push</code>),
            then reload this page to mint admin keys.
          </p>
        </div>
      </div>
    )
  }

  const active = keys.filter((k) => !k.revoked_at)
  const revoked = keys.filter((k) => k.revoked_at)

  return (
    <div className="space-y-5">
      {/* Mint */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-2 text-sm font-medium">Generate a new admin key</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. ops-bot, ci-writer)"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/60"
          />
          <Button onClick={generate} disabled={pending} size="lg" className="gap-1.5">
            <Plus className="h-4 w-4" />
            {pending ? 'Working…' : 'Generate key'}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      {/* Freshly minted key — shown once */}
      {newKey && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm">
              Copy this key now — it won’t be shown again. Store it as a secret.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <code className="flex-1 overflow-x-auto text-xs">{newKey}</code>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newKey)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {
                  /* clipboard unavailable */
                }
              }}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ConnectOptions path="/api/mcp/admin" name="flytbase-docs-admin" withAuth apiKey={newKey} />
          <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
            Done
          </Button>
        </div>
      )}

      {/* Existing keys */}
      <div>
        <p className="mb-2 text-sm font-medium">
          Keys {active.length > 0 && <span className="text-muted-foreground">({active.length} active)</span>}
        </p>
        {keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No keys yet. Generate one above to connect an admin agent.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {[...active, ...revoked].map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                <Key className={'h-4 w-4 shrink-0 ' + (k.revoked_at ? 'text-muted-foreground' : 'text-primary')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {k.label || 'admin'}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{k.key_prefix}…</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {fmt(k.created_at)} · Last used {fmt(k.last_used_at)}
                  </p>
                </div>
                {k.revoked_at ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Revoked</span>
                ) : (
                  <Button variant="destructive" size="sm" onClick={() => revoke(k.id)} disabled={pending} className="gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
