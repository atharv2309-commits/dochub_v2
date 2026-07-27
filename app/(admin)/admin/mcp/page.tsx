import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { ConnectOptions } from '@/components/mcp/ConnectOptions'
import { McpKeyManager } from '@/components/admin/McpKeyManager'
import { listKeys, type AdminKeyRow } from '@/lib/mcp/admin-keys'

export const dynamic = 'force-dynamic'

export default async function McpAdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // The mcp_api_keys table may not exist locally until the migration is applied.
  let keys: AdminKeyRow[] = []
  let available = true
  try {
    keys = await listKeys()
  } catch {
    available = false
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader email={user.email ?? ''} />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <p className="eyebrow">Integrations</p>
          <h1 className="mt-1.5 flex items-center gap-2.5 text-4xl font-bold tracking-tight">
            <Sparkles className="h-7 w-7 text-primary" />
            MCP servers
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Let AI agents read and operate your docs over the Model Context Protocol. The public
            server is read-only; the admin server lets trusted agents create, edit, and publish
            pages headlessly using an API key.
          </p>
        </div>

        <div className="space-y-8">
          {/* Public server */}
          <section className="card-elevated rounded-xl p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Public docs server</h2>
                <p className="text-sm text-muted-foreground">
                  Anonymous, read-only. Search & read published, public content.
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> Live
              </span>
            </div>
            <ConnectOptions path="/api/mcp" name="flytbase-docs" />
          </section>

          {/* Admin server + keys */}
          <section className="card-elevated rounded-xl p-5">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Admin server</h2>
              <p className="text-sm text-muted-foreground">
                Authenticated with an API key. Full write access — create, edit, publish, and
                delete pages. Treat keys as platform secrets.
              </p>
            </div>
            <McpKeyManager keys={keys} available={available} />
          </section>
        </div>
      </main>
    </div>
  )
}
