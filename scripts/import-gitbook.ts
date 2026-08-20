/**
 * Import a local GitBook-exported git checkout (SUMMARY.md + markdown files +
 * .gitbook/assets) into a DocHub project.
 *
 * Run:  npx tsx scripts/import-gitbook.ts <path-to-repo-checkout> [projectSlug] [projectName]
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: IMPORT_OWNER_EMAIL — reuse an existing user as the project owner
 *   (defaults to the first user in the project, or creates one if none exist).
 */
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, join, extname } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { markdownToBlocks, type ConvertResult } from '../lib/import/markdownToBlocks'
import { parseGitbookSummary, type SummaryNode } from '../lib/import/gitbookSummary'
import { gifBufferToMp4 } from '../lib/import/gifToVideo'

const run = promisify(execFile)

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
const REPO_PATH = process.argv[2]
const PROJECT_SLUG = process.argv[3] || 'flytbase-docs'
const PROJECT_NAME =
  process.argv[4] ||
  PROJECT_SLUG.split('-')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
const MAX_HOST_BYTES = 26214400 // 25MB — the images bucket's hard limit
const GIF_TRANSCODE_THRESHOLD = 3 * 1024 * 1024

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!REPO_PATH || !existsSync(resolve(REPO_PATH, 'SUMMARY.md'))) {
  console.error('Usage: npx tsx scripts/import-gitbook.ts <path-to-repo-checkout> [projectSlug]')
  console.error('(expects a SUMMARY.md at the root of <path-to-repo-checkout>)')
  process.exit(1)
}
const repoRoot = resolve(REPO_PATH)

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// ---- asset conversion (mirrors lib/import/gifToVideo.ts's ffmpeg pattern) ----

async function ffmpegConvert(buf: Uint8Array, inExt: string, outExt: string, extraArgs: string[]): Promise<Uint8Array | null> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'docimport-'))
    const inPath = join(dir, `in.${inExt}`)
    const outPath = join(dir, `out.${outExt}`)
    await writeFile(inPath, buf)
    await run('ffmpeg', ['-y', '-i', inPath, ...extraArgs, outPath], { maxBuffer: 1024 * 1024 * 64 })
    return Uint8Array.from(await readFile(outPath))
  } catch {
    return null
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
}

// Resolve a local asset file to a hosted (or dropped) URL + mime, converting
// formats the storage bucket doesn't accept (bmp/tiff/avif/no-extension ->
// png, mkv -> mp4) and large GIFs -> mp4, same as the live-GitBook importer.
async function prepareAsset(absPath: string): Promise<{ buf: Uint8Array; ext: string; mime: string } | null> {
  const raw = await readFile(absPath).catch(() => null)
  if (!raw) return null
  const buf = Uint8Array.from(raw)
  const ext = extname(absPath).slice(1).toLowerCase()

  if (ext === 'gif' && buf.byteLength >= GIF_TRANSCODE_THRESHOLD) {
    const mp4 = await gifBufferToMp4(buf)
    return mp4 ? { buf: mp4, ext: 'mp4', mime: 'video/mp4' } : null
  }
  if (ext in IMAGE_MIME) return { buf, ext, mime: IMAGE_MIME[ext] }
  if (ext === 'mkv') {
    const mp4 = await ffmpegConvert(buf, ext, 'mp4', ['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-an'])
    return mp4 ? { buf: mp4, ext: 'mp4', mime: 'video/mp4' } : null
  }
  // bmp, tiff, avif, or files with no/unknown extension — normalize to png.
  const png = await ffmpegConvert(buf, ext || 'bin', 'png', [])
  return png ? { buf: png, ext: 'png', mime: 'image/png' } : null
}

const assetCache = new Map<string, string | null>() // absPath -> hosted URL (or null = dropped)

async function hostAsset(absPath: string, projectId: string): Promise<string | null> {
  if (assetCache.has(absPath)) return assetCache.get(absPath)!
  const prepared = await prepareAsset(absPath)
  if (!prepared || prepared.buf.byteLength > MAX_HOST_BYTES) {
    console.warn(`  ! dropped asset (unreadable or >25MB): ${absPath}`)
    assetCache.set(absPath, null)
    return null
  }
  const hash = createHash('sha1').update(absPath).digest('hex')
  const path = `imported/${projectId}/${hash}.${prepared.ext}`
  const { error } = await sb.storage.from('images').upload(path, prepared.buf, { contentType: prepared.mime, upsert: true })
  if (error) {
    console.warn(`  ! upload failed for ${absPath}: ${error.message}`)
    assetCache.set(absPath, null)
    return null
  }
  const url = sb.storage.from('images').getPublicUrl(path).data.publicUrl
  assetCache.set(absPath, url)
  return url
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveImages(blocks: any[], mdDir: string, projectId: string): Promise<void> {
  for (const block of blocks) {
    if (block?.type === 'image' && typeof block.props?.url === 'string' && block.props.url) {
      const src: string = block.props.url
      if (!/^(https?:)?\/\//i.test(src)) {
        const absPath = resolve(mdDir, decodeURIComponent(src))
        block.props.url = (await hostAsset(absPath, projectId)) ?? ''
      }
    }
    if (Array.isArray(block?.children) && block.children.length) {
      await resolveImages(block.children, mdDir, projectId)
    }
  }
}

// ---- project + owner setup ----

async function ensureOwner(): Promise<string> {
  const preferredEmail = process.env.IMPORT_OWNER_EMAIL
  const { data: list } = await sb.auth.admin.listUsers()
  if (preferredEmail) {
    const match = list?.users.find((u) => u.email === preferredEmail)
    if (match) return match.id
  }
  if (list?.users.length) return list.users[0].id

  const email = preferredEmail || 'admin@dochub.local'
  const password = randomBytes(9).toString('base64url')
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`could not create owner user: ${error?.message}`)
  console.log(`\nCreated admin login — email: ${email}  password: ${password}\n`)
  return data.user.id
}

async function ensureProject(ownerId: string, description: string): Promise<string> {
  const { data: existing } = await sb.from('projects').select('id').eq('slug', PROJECT_SLUG).eq('user_id', ownerId).maybeSingle()
  if (existing) return existing.id
  const { data: inserted, error } = await sb
    .from('projects')
    .insert({ user_id: ownerId, name: PROJECT_NAME, slug: PROJECT_SLUG, description, visibility: 'public' })
    .select('id')
    .single()
  if (error || !inserted) throw new Error(`could not create project: ${error?.message}`)
  return inserted.id
}

// ---- page tree insertion ----

let created = 0
const errors: string[] = []

async function insertNode(node: SummaryNode, projectId: string, parentId: string | null, parentPath: string | null, order: number) {
  const path = parentPath ? `${parentPath}/${node.slug}` : node.slug

  let title = node.title
  let description: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let content: any = null

  if (node.kind === 'document' && node.mdPath) {
    const absMd = join(repoRoot, node.mdPath)
    const raw = await readFile(absMd, 'utf8').catch(() => null)
    if (raw === null) {
      errors.push(`missing file: ${node.mdPath}`)
    } else {
      const converted: ConvertResult = markdownToBlocks(raw)
      await resolveImages(converted.blocks, dirname(absMd), projectId)
      content = converted.blocks
      if (converted.title) title = converted.title
      if (converted.description) description = converted.description
    }
  }

  const { data: inserted, error } = await sb
    .from('pages')
    .insert({
      project_id: projectId,
      parent_id: parentId,
      title,
      description,
      slug: node.slug,
      path,
      kind: node.kind,
      content,
      order_index: order,
      status: 'published',
    })
    .select('id')
    .single()

  if (error || !inserted) {
    errors.push(`insert failed: ${path} — ${error?.message ?? 'unknown'}`)
    return
  }
  created++
  console.log(`  + ${path}`)

  if (node.kind === 'document') {
    await sb.rpc('create_page_version', {
      p_page_id: inserted.id,
      p_is_published: true,
      p_change_summary: 'Imported from flytbase-docs',
    })
  }

  let childOrder = 1000
  for (const child of node.children) {
    await insertNode(child, projectId, inserted.id, path, childOrder)
    childOrder += 1000
  }
}

async function main() {
  const summary = await readFile(join(repoRoot, 'SUMMARY.md'), 'utf8')
  const tree = parseGitbookSummary(summary)

  const rootReadme = await readFile(join(repoRoot, 'README.md'), 'utf8').catch(() => '')
  const rootDescription = rootReadme ? markdownToBlocks(rootReadme).description : ''

  const ownerId = await ensureOwner()
  const projectId = await ensureProject(ownerId, rootDescription)

  let order = 1000
  for (const node of tree) {
    await insertNode(node, projectId, null, null, order)
    order += 1000
  }

  console.log(`\nDone. ${created} pages created.`)
  if (errors.length) {
    console.log(`${errors.length} issue(s):`)
    for (const e of errors) console.log(`  - ${e}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
