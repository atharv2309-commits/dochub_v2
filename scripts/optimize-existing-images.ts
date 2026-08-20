// One-off backfill: re-process every already-uploaded image through
// optimizeImage() (resize-only, same format — never changes a stored URL)
// and re-upload in place with a long-lived cache-control header. Safe to
// re-run any time; already-small images just get their cache header fixed.
//
// Usage: npx tsx scripts/optimize-existing-images.ts
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'

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
  const { createClient } = await import('@supabase/supabase-js')
  const { optimizeImage } = await import('../lib/import/optimizeImage')

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: projects, error: projErr } = await sb.from('projects').select('id, slug')
  if (projErr) throw new Error(projErr.message)

  let totalBefore = 0
  let totalAfter = 0
  let processed = 0
  let shrunk = 0
  let skipped = 0

  for (const project of projects ?? []) {
    const prefix = `imported/${project.id}/`
    const { data: objects, error: listErr } = await sb.storage.from('images').list(prefix.slice(0, -1), { limit: 2000 })
    if (listErr) {
      console.warn(`  ! list failed for ${project.slug}: ${listErr.message}`)
      continue
    }
    console.log(`\n${project.slug}: ${objects?.length ?? 0} objects`)

    for (const obj of objects ?? []) {
      if (!obj.metadata) continue // a sub-"folder" marker, not a file
      const path = `${prefix}${obj.name}`
      const { data: blob, error: dlErr } = await sb.storage.from('images').download(path)
      if (dlErr || !blob) {
        console.warn(`  ! download failed: ${path} — ${dlErr?.message}`)
        skipped++
        continue
      }
      const before = obj.metadata.size as number
      const raw = new Uint8Array(await blob.arrayBuffer())
      const ext = extname(obj.name).slice(1).toLowerCase()
      const optimized = await optimizeImage(raw, ext)
      const after = optimized.byteLength

      const { error: upErr } = await sb.storage
        .from('images')
        .upload(path, optimized, { contentType: blob.type, upsert: true, cacheControl: '31536000' })
      if (upErr) {
        console.warn(`  ! re-upload failed: ${path} — ${upErr.message}`)
        skipped++
        continue
      }

      totalBefore += before
      totalAfter += after
      processed++
      if (after < before) {
        shrunk++
        console.log(`  ${path}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`)
      }
    }
  }

  console.log(`\nDone. ${processed} processed (${shrunk} resized, ${skipped} skipped on error).`)
  console.log(`Total: ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB`)
  const pct = totalBefore > 0 ? (100 - (totalAfter / totalBefore) * 100).toFixed(0) : '0'
  console.log(`Reduction: ${pct}%`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
