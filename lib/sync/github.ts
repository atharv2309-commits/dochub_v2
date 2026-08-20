// Sync a DocHub project from a GitHub repo in GitBook Git-Sync layout
// (SUMMARY.md + nested .md files + .gitbook/assets/), fetched file-by-file via
// GitHub's API — never a bulk clone/tarball. On first sync every document is
// fetched; after that, only files GitHub's Compare API reports as changed are
// re-fetched (SUMMARY.md itself is always re-read, since it's tiny, so
// structural moves/new pages are always caught cheaply). Runs via the
// service-role client, same as the translation worker and the GitBook-API
// importer — bypasses RLS, so no session/ownership check happens in here;
// callers (the Sync action, the webhook-approved sync) must already have
// authorized the caller before invoking this.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, posix } from 'node:path'
import { promisify } from 'node:util'
import { createServiceClient } from '@/lib/supabase/service'
import { markdownToBlocks } from '@/lib/import/markdownToBlocks'
import { parseGitbookSummary, type SummaryNode } from '@/lib/import/gitbookSummary'
import { gifBufferToMp4 } from '@/lib/import/gifToVideo'
import { optimizeImage } from '@/lib/import/optimizeImage'
import type { PageUpdate } from '@/types/db'

const run = promisify(execFile)
const GITHUB_API = 'https://api.github.com'
const MAX_HOST_BYTES = 26214400 // images bucket's hard limit
const GIF_TRANSCODE_THRESHOLD = 3 * 1024 * 1024

function githubToken(): string {
  const t = process.env.GITHUB_SYNC_TOKEN
  if (!t) throw new Error('GITHUB_SYNC_TOKEN not configured')
  return t
}

// ---- GitHub API (raw content — one small HTTP call per file, no cloning) ----

function encodeRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

// GitHub connections drop mid-transfer often enough on some networks to be
// routine, not exceptional (undici throws a raw TypeError/SocketError, not an
// HTTP status) — one retry after a short pause absorbs that without treating
// a single flaky request as fatal to the whole file.
async function fetchWithRetry(url: string, headers: Record<string, string>, attempts = 3): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers })
      return res
    } catch {
      if (i === attempts - 1) return null
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  return null
}

async function fetchRawFile(repo: string, path: string, ref: string): Promise<Uint8Array | null> {
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
    { Authorization: `Bearer ${githubToken()}`, Accept: 'application/vnd.github.raw+json' }
  )
  if (!res || !res.ok) return null
  try {
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null // connection dropped mid-body — treat like any other unavailable file
  }
}

async function fetchTextFile(repo: string, path: string, ref: string): Promise<string | null> {
  const bytes = await fetchRawFile(repo, path, ref)
  return bytes ? new TextDecoder().decode(bytes) : null
}

async function getBranchHeadSha(repo: string, branch: string): Promise<string> {
  const res = await fetchWithRetry(`${GITHUB_API}/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
    Authorization: `Bearer ${githubToken()}`, Accept: 'application/vnd.github+json',
  })
  if (!res || !res.ok) throw new Error(`could not resolve ${repo}@${branch}: ${res?.status ?? 'network error'}`)
  const json = await res.json()
  return json.sha as string
}

interface CompareResult {
  files: string[]
  totalCommits: number
}

async function compareCommits(repo: string, base: string, head: string): Promise<CompareResult> {
  const res = await fetchWithRetry(`${GITHUB_API}/repos/${repo}/compare/${base}...${head}`, {
    Authorization: `Bearer ${githubToken()}`, Accept: 'application/vnd.github+json',
  })
  if (!res || !res.ok) throw new Error(`could not compare ${repo} ${base}...${head}: ${res?.status ?? 'network error'}`)
  const json = await res.json()
  const files: string[] = (json.files ?? []).map((f: { filename: string }) => f.filename)
  return { files, totalCommits: json.total_commits ?? 0 }
}

// ---- asset hosting (fetch one file from GitHub -> upload to Supabase Storage) ----

async function ffmpegConvert(buf: Uint8Array, inExt: string, outExt: string, extraArgs: string[]): Promise<Uint8Array | null> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'ghsync-'))
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
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif',
}

async function prepareAsset(buf: Uint8Array, ext: string): Promise<{ buf: Uint8Array; ext: string; mime: string } | null> {
  if (ext === 'gif' && buf.byteLength >= GIF_TRANSCODE_THRESHOLD) {
    const mp4 = await gifBufferToMp4(buf)
    return mp4 ? { buf: mp4, ext: 'mp4', mime: 'video/mp4' } : null
  }
  if (ext in IMAGE_MIME) return { buf: await optimizeImage(buf, ext), ext, mime: IMAGE_MIME[ext] }
  if (ext === 'mkv') {
    const mp4 = await ffmpegConvert(buf, ext, 'mp4', ['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-an'])
    return mp4 ? { buf: mp4, ext: 'mp4', mime: 'video/mp4' } : null
  }
  const png = await ffmpegConvert(buf, ext || 'bin', 'png', [])
  return png ? { buf: await optimizeImage(png, 'png'), ext: 'png', mime: 'image/png' } : null
}

function resolveRepoPath(mdPath: string, relSrc: string): string {
  return posix.normalize(posix.join(posix.dirname(mdPath), decodeURIComponent(relSrc)))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hostAsset(sb: any, repo: string, ref: string, repoPath: string, projectId: string, cache: Map<string, string | null>): Promise<string | null> {
  const key = `${repo}@${repoPath}`
  if (cache.has(key)) return cache.get(key)!
  const raw = await fetchRawFile(repo, repoPath, ref)
  if (!raw) { cache.set(key, null); return null }
  const prepared = await prepareAsset(raw, extname(repoPath).slice(1).toLowerCase())
  if (!prepared || prepared.buf.byteLength > MAX_HOST_BYTES) { cache.set(key, null); return null }
  const hash = createHash('sha1').update(key).digest('hex')
  const path = `imported/${projectId}/${hash}.${prepared.ext}`
  try {
    // Content-hashed path (sha1 of the source repo path) is effectively
    // immutable, so cache aggressively — the Supabase default (1hr) meant
    // every repeat fetch (every PDF export, every viewer) re-hit origin egress.
    const { error } = await sb.storage.from('images').upload(path, prepared.buf, { contentType: prepared.mime, upsert: true, cacheControl: '31536000' })
    if (error) { cache.set(key, null); return null }
  } catch {
    cache.set(key, null) // dropped connection mid-upload — skip just this image, not the page
    return null
  }
  const url = sb.storage.from('images').getPublicUrl(path).data.publicUrl
  cache.set(key, url)
  return url
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveImages(blocks: any[], mdPath: string, repo: string, ref: string, projectId: string, sb: any, cache: Map<string, string | null>): Promise<void> {
  for (const block of blocks) {
    if (block?.type === 'image' && typeof block.props?.url === 'string' && block.props.url) {
      const src: string = block.props.url
      if (!/^(https?:)?\/\//i.test(src)) {
        block.props.url = (await hostAsset(sb, repo, ref, resolveRepoPath(mdPath, src), projectId, cache)) ?? ''
      }
    }
    if (Array.isArray(block?.children) && block.children.length) {
      await resolveImages(block.children, mdPath, repo, ref, projectId, sb, cache)
    }
  }
}

// ---- sync orchestration ----

export interface SyncResult {
  headSha: string
  noChanges: boolean
  pagesAdded: number
  pagesUpdated: number
  pagesUnreferenced: string[] // github_path values no longer listed in SUMMARY.md — flagged, not deleted
  errors: string[]
}

export async function syncProject(projectId: string): Promise<SyncResult> {
  const sb = createServiceClient()

  const { data: project, error: projectErr } = await sb
    .from('projects')
    .select('id, github_repo, github_branch, github_last_synced_sha')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) throw new Error('project not found')
  if (!project.github_repo) throw new Error('project has no linked GitHub repo')

  const repo = project.github_repo
  const ref = project.github_branch || 'main'
  const lastSha = project.github_last_synced_sha as string | null
  const headSha = await getBranchHeadSha(repo, ref)

  if (lastSha === headSha) {
    return { headSha, noChanges: true, pagesAdded: 0, pagesUpdated: 0, pagesUnreferenced: [], errors: [] }
  }

  // null = bootstrap (first sync ever): treat every document as changed.
  let changedPaths: Set<string> | null = null
  if (lastSha) {
    const { files } = await compareCommits(repo, lastSha, headSha)
    changedPaths = new Set(files)
  }

  const summaryText = await fetchTextFile(repo, 'SUMMARY.md', headSha)
  if (summaryText === null) throw new Error(`SUMMARY.md not found at ${repo}@${ref}`)
  const tree = parseGitbookSummary(summaryText)

  const { data: existingPages } = await sb.from('pages').select('id, github_path, path').eq('project_id', projectId)
  const byGithubPath = new Map<string, string>()
  const byPath = new Map<string, string>()
  for (const p of existingPages ?? []) {
    if (p.github_path) byGithubPath.set(p.github_path, p.id)
    byPath.set(p.path, p.id)
  }
  const visitedGithubPaths = new Set<string>()

  const assetCache = new Map<string, string | null>()
  let pagesAdded = 0
  let pagesUpdated = 0
  const errors: string[] = []

  // One node's failure (a dropped connection mid-fetch, an unexpected write
  // error) must never abort the whole tree — GitHub's API drops connections
  // often enough on some networks to be routine. Every exception is caught
  // here, logged, and the walk moves on; only that node's own subtree is lost.
  async function walk(node: SummaryNode, parentId: string | null, parentPath: string | null, order: number) {
    try {
      await walkInner(node, parentId, parentPath, order)
    } catch (err) {
      errors.push(`sync failed at ${node.mdPath ?? node.title}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function walkInner(node: SummaryNode, parentId: string | null, parentPath: string | null, order: number) {
    const path = parentPath ? `${parentPath}/${node.slug}` : node.slug
    // Documents key on github_path (stable across title/slug renames); groups
    // have no source file, so their deterministic tree path is the only key —
    // renaming a group's GitHub title will orphan the old row (out of scope).
    const existingId = node.mdPath ? byGithubPath.get(node.mdPath) : byPath.get(path)
    if (node.mdPath) visitedGithubPaths.add(node.mdPath)

    const needsContent =
      node.kind === 'document' && !!node.mdPath &&
      (changedPaths === null || !existingId || changedPaths.has(node.mdPath))

    let title = node.title
    let description: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let content: any[] | undefined // undefined = leave the column untouched on update

    if (needsContent && node.mdPath) {
      const raw = await fetchTextFile(repo, node.mdPath, headSha)
      if (raw === null) {
        errors.push(`missing file: ${node.mdPath}`)
      } else {
        const converted = markdownToBlocks(raw)
        await resolveImages(converted.blocks, node.mdPath, repo, headSha, projectId, sb, assetCache)
        content = converted.blocks
        if (converted.title) title = converted.title
        description = converted.description || null
      }
    }

    let pageId: string
    if (existingId) {
      pageId = existingId
      const update: PageUpdate = { parent_id: parentId, order_index: order, title, slug: node.slug, path }
      if (content !== undefined) { update.content = content; update.description = description; update.status = 'published' }
      const { error } = await sb.from('pages').update(update).eq('id', pageId)
      if (error) errors.push(`update failed: ${path} — ${error.message}`)
      else if (content !== undefined) pagesUpdated++
    } else {
      const { data: inserted, error } = await sb
        .from('pages')
        .insert({
          project_id: projectId, parent_id: parentId, title, description,
          slug: node.slug, path, kind: node.kind,
          content: content ?? null, github_path: node.mdPath ?? null,
          order_index: order, status: 'published',
        })
        .select('id')
        .single()
      if (error || !inserted) { errors.push(`insert failed: ${path} — ${error?.message ?? 'unknown'}`); return }
      pageId = inserted.id
      pagesAdded++
    }

    if (node.kind === 'document' && content !== undefined) {
      await sb.rpc('create_page_version', { p_page_id: pageId, p_is_published: true, p_change_summary: 'Synced from GitHub' })
      await sb.rpc('enqueue_page_translations', { p_page_id: pageId })
    }

    let childOrder = 1000
    for (const child of node.children) {
      await walk(child, pageId, path, childOrder)
      childOrder += 1000
    }
  }

  let order = 1000
  for (const node of tree) {
    await walk(node, null, null, order)
    order += 1000
  }

  const pagesUnreferenced = Array.from(byGithubPath.keys()).filter((p) => !visitedGithubPaths.has(p))

  await sb.from('projects').update({ github_last_synced_sha: headSha }).eq('id', projectId)

  return { headSha, noChanges: false, pagesAdded, pagesUpdated, pagesUnreferenced, errors }
}

// Cheap check (2 small API calls, no file fetches) — used by the webhook to
// build a notification summary without doing any of the actual sync work.
export async function checkForChanges(repo: string, branch: string, lastSha: string | null): Promise<{ headSha: string; hasChanges: boolean; summary: string }> {
  const headSha = await getBranchHeadSha(repo, branch)
  if (!lastSha) return { headSha, hasChanges: true, summary: 'Not yet synced' }
  if (headSha === lastSha) return { headSha, hasChanges: false, summary: 'Up to date' }
  const { files, totalCommits } = await compareCommits(repo, lastSha, headSha)
  return { headSha, hasChanges: true, summary: `${totalCommits} commit${totalCommits === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} changed` }
}
