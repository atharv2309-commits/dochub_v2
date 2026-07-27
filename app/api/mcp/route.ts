import { createMcpHandler } from 'mcp-handler'
import { registerPublicTools } from '@/lib/mcp/public-tools'
import { withRateLimit, clientIp } from '@/lib/mcp/rate-limit'

// PUBLIC MCP server — anonymous, read-only "talk to the docs".
// Streamable HTTP endpoint: POST https://<site>/api/mcp
// No auth: every tool reads through the anon Supabase client, so RLS makes only
// published/public content reachable and no write tool is registered.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const handler = createMcpHandler(
  (server) => {
    registerPublicTools(server)
  },
  { serverInfo: { name: 'dochub-docs', version: '1.0.0' } },
  { streamableHttpEndpoint: '/api/mcp', disableSse: true, maxDuration: 60 }
)

// Per-IP rate limit: ~60 burst, 1 req/sec sustained — generous for an interactive
// docs client, a real backstop against anonymous hammering.
const limited = withRateLimit(handler, {
  capacity: 60,
  refillPerSec: 1,
  keyFn: (req) => `pub:${clientIp(req)}`,
})

export { limited as GET, limited as POST, limited as DELETE }
