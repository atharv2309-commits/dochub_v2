import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { registerAdminTools } from '@/lib/mcp/admin-tools'
import { verifyAdminKey } from '@/lib/mcp/keys'
import { withRateLimit, clientIp } from '@/lib/mcp/rate-limit'

// ADMIN MCP server — authenticated, write tools for headless platform operation.
// Streamable HTTP endpoint: POST https://<site>/api/mcp/admin
// Auth: a bearer API key (Authorization: Bearer dhk_...) verified against
// mcp_api_keys. Missing/invalid key → 401; key without the "admin" scope → 403.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const handler = createMcpHandler(
  (server) => {
    registerAdminTools(server)
  },
  { serverInfo: { name: 'dochub-docs-admin', version: '1.0.0' } },
  { streamableHttpEndpoint: '/api/mcp/admin', disableSse: true, maxDuration: 60 }
)

// Validate the bearer API key and map it to scopes. The key id is carried in
// `extra.keyId` so tools can attribute writes in the audit log.
async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  const info = await verifyAdminKey(bearer)
  if (!info) return undefined
  return {
    token: bearer as string,
    clientId: info.keyId,
    scopes: info.scopes,
    extra: { keyId: info.keyId, label: info.label },
  }
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ['admin'],
})

// Rate-limit by IP in front of auth so unauthenticated hammering of the key check
// is also bounded. Higher ceiling than public since callers are trusted agents.
const limited = withRateLimit(authHandler, {
  capacity: 120,
  refillPerSec: 2,
  keyFn: (req) => `adm:${clientIp(req)}`,
})

export { limited as GET, limited as POST, limited as DELETE }
