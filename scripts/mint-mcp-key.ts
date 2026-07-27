/**
 * Mint an admin MCP API key.
 *
 * Generates a high-entropy key, stores only its SHA-256 hash in mcp_api_keys, and
 * prints the raw key ONCE (it is never recoverable afterwards). Give this key to a
 * trusted admin agent as the Bearer token for POST <site>/api/mcp/admin.
 *
 * Run:    npx tsx scripts/mint-mcp-key.ts "label for this key"
 * Revoke: set revoked_at on the row (or DELETE it).
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* ignore */
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LABEL = process.argv[2] || 'admin'

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  const raw = `dhk_${randomBytes(32).toString('base64url')}`
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex')
  const prefix = raw.slice(0, 12)

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await sb.from('mcp_api_keys').insert({
    label: LABEL,
    key_prefix: prefix,
    key_hash: hash,
    scopes: ['admin'],
  })
  if (error) {
    console.error('Failed to store key:', error.message)
    process.exit(1)
  }

  console.log('\n✅ Admin MCP key minted. Copy it now — it will not be shown again:\n')
  console.log(`   ${raw}\n`)
  console.log(`   label:  ${LABEL}`)
  console.log(`   prefix: ${prefix}`)
  console.log('\nUse it as the bearer token for the admin MCP server:')
  console.log('   Authorization: Bearer ' + raw)
  console.log('   Endpoint: POST <your-site>/api/mcp/admin\n')
}

main()
