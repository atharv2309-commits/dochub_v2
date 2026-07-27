'use client'

import { useState, useSyncExternalStore } from 'react'
import { Check, Copy, Terminal } from 'lucide-react'
import { useDict } from '@/components/i18n/DictionaryProvider'

// SSR-safe read of the current origin: '' on the server, the real origin on the
// client (so snippets show localhost in dev and the deployed URL in production),
// with no hydration mismatch and no setState-in-effect.
const EMPTY_SUBSCRIBE = () => () => {}
function useOrigin(): string {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => window.location.origin,
    () => ''
  )
}

// Shared MCP connection helper used by both the public docs dialog and the admin
// MCP page. It derives the absolute server URL from window.location.origin, so the
// snippets are correct automatically in local dev (localhost) and in production
// (the deployed Vercel/custom-domain URL) without any configuration.

type Method = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'url'

const METHODS: { id: Method; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'url', label: 'Server URL' },
]

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const dict = useDict()
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      aria-label={dict.mcp.copy}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-400" /> {dict.code.copied}
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> {dict.mcp.copy}
        </>
      )}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg border border-border/60 bg-secondary/40">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <span className="eyebrow flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
          <Terminal className="h-3 w-3" /> snippet
        </span>
        <CopyBtn text={code} />
      </div>
      {/* Wrap long URLs/commands instead of scrolling — no horizontal scroll. */}
      <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function ConnectOptions({
  path,
  name,
  withAuth = false,
  apiKey,
}: {
  /** Endpoint path, e.g. "/api/mcp" or "/api/mcp/admin". */
  path: string
  /** Server name shown in client config (e.g. "flytbase-docs"). */
  name: string
  /** Include an Authorization: Bearer header in snippets (admin server). */
  withAuth?: boolean
  /** A freshly-minted key to inline into snippets; falls back to a placeholder. */
  apiKey?: string
}) {
  const origin = useOrigin()
  const dict = useDict()
  const [method, setMethod] = useState<Method>('claude-code')

  const url = `${origin || 'https://your-docs-site'}${path}`
  const token = apiKey || '<YOUR_ADMIN_KEY>'
  const headerFlag = withAuth ? ` --header "Authorization: Bearer ${token}"` : ''
  const headersJson = withAuth ? `,\n        "headers": { "Authorization": "Bearer ${token}" }` : ''

  const snippets: Record<Method, string> = {
    'claude-code': `claude mcp add --transport http ${name} ${url}${headerFlag}`,
    'claude-desktop': `{
  "mcpServers": {
    "${name}": {
      "url": "${url}"${headersJson}
    }
  }
}`,
    cursor: `{
  "mcpServers": {
    "${name}": {
      "url": "${url}"${headersJson}
    }
  }
}`,
    vscode: `code --add-mcp '{"name":"${name}","url":"${url}"${
      withAuth ? `,"headers":{"Authorization":"Bearer ${token}"}` : ''
    }}'`,
    url: url,
  }

  const hint: Record<Method, string> = {
    'claude-code': dict.mcp.hintClaudeCode,
    'claude-desktop': dict.mcp.hintClaudeDesktop,
    cursor: dict.mcp.hintCursor,
    vscode: dict.mcp.hintVscode,
    url: dict.mcp.hintUrl,
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {METHODS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            className={
              'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
              (method === m.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border/60 text-muted-foreground hover:text-foreground')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <CodeBlock code={snippets[method]} />
      <p className="text-xs text-muted-foreground">{hint[method]}</p>
    </div>
  )
}
