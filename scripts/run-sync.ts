// One-off: run the GitHub sync engine directly for a given project slug,
// bypassing the admin UI. Usage: npx tsx scripts/run-sync.ts <project-slug>
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

async function main() {
  const slug = process.argv[2]
  if (!slug) {
    console.error('Usage: npx tsx scripts/run-sync.ts <project-slug>')
    process.exit(1)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: project, error } = await sb.from('projects').select('id').eq('slug', slug).single()
  if (error || !project) {
    console.error('project not found:', slug, error?.message)
    process.exit(1)
  }

  const { syncProject } = await import('../lib/sync/github')
  console.log(`Syncing project ${slug} (${project.id})...`)
  const result = await syncProject(project.id)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
