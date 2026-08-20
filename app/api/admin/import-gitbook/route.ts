import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markdownToBlocks } from '@/lib/import/markdownToBlocks'
import { optimizeImage } from '@/lib/import/optimizeImage'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 300

const MAX_HOST_BYTES = 26214400 // 25MB — larger assets are hotlinked

interface ImportNode {
  title: string
  slug: string
  kind?: 'document' | 'group'
  gbPath?: string // GitBook page path to fetch as markdown (documents only)
  children?: ImportNode[]
}

interface ImportBody {
  projectSlug: string
  tree: ImportNode[]
  gitbookSpaceId?: string
  gitbookToken?: string
}

interface GbFile {
  downloadURL: string
  contentType: string
  name: string
}

async function fetchMarkdown(gbPath: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.flytbase.com/${gbPath}.md`, {
      headers: { 'User-Agent': 'Mozilla/5.0 DocHubImporter' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// Build a map of GitBook file id -> download info (paginated).
async function fetchGitbookFiles(spaceId: string, token: string): Promise<Map<string, GbFile>> {
  const map = new Map<string, GbFile>()
  let pageCursor: string | undefined
  for (let i = 0; i < 50; i++) {
    const url = new URL(`https://api.gitbook.com/v1/spaces/${spaceId}/content/files`)
    url.searchParams.set('limit', '100')
    if (pageCursor) url.searchParams.set('page', pageCursor)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const data = await res.json()
    for (const f of data.items ?? []) {
      if (f?.id && f?.downloadURL) {
        map.set(f.id, { downloadURL: f.downloadURL, contentType: f.contentType ?? 'image/png', name: f.name ?? '' })
      }
    }
    pageCursor = data?.next?.page
    if (!pageCursor) break
  }
  return map
}

// Download a GitBook asset and self-host it in Supabase Storage.
// Returns the hosted public URL, or null to signal "hotlink the source instead".
async function hostImage(
  supabase: SupabaseClient,
  file: GbFile,
  fileId: string,
  projectId: string
): Promise<string | null> {
  try {
    const res = await fetch(file.downloadURL)
    if (!res.ok) return null
    const raw = new Uint8Array(await res.arrayBuffer())
    if (raw.byteLength > MAX_HOST_BYTES) return null
    const extFromName = file.name.includes('.') ? file.name.split('.').pop() : undefined
    const ext = (extFromName ?? file.contentType.split('/').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const buf = await optimizeImage(raw, ext)
    const path = `imported/${projectId}/${fileId}.${ext}`
    const { error } = await supabase.storage
      .from('images')
      // Content-addressed path (GitBook's own file id) is immutable — cache
      // aggressively so repeat fetches (PDF export, every viewer) don't keep
      // re-hitting origin egress on the Supabase default (1hr) ttl.
      .upload(path, buf, { contentType: file.contentType, upsert: true, cacheControl: '31536000' })
    if (error) return null
    return supabase.storage.from('images').getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}

// Replace `gitbook-file:<ID>` placeholders in image blocks with hosted URLs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: any[],
  fileMap: Map<string, GbFile>,
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  let resolved = 0
  for (const block of blocks) {
    if (block?.type === 'image' && typeof block.props?.url === 'string' && block.props.url.startsWith('gitbook-file:')) {
      const fileId = block.props.url.slice('gitbook-file:'.length)
      const file = fileMap.get(fileId)
      if (!file) {
        block.props.url = '' // unknown file → drop the broken image
        continue
      }
      const hosted = await hostImage(supabase, file, fileId, projectId)
      block.props.url = hosted ?? file.downloadURL
      if (!block.props.name) block.props.name = file.name
      resolved++
    }
    if (Array.isArray(block?.children) && block.children.length) {
      resolved += await resolveImages(block.children, fileMap, supabase, projectId)
    }
  }
  return resolved
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json()) as ImportBody
  if (!body?.projectSlug || !Array.isArray(body.tree)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', body.projectSlug)
    .eq('user_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const projectId = project.id
  let created = 0
  let imagesResolved = 0
  const errors: string[] = []

  // Resolve GitBook asset references if credentials are available.
  const spaceId = body.gitbookSpaceId ?? process.env.GITBOOK_SPACE_ID
  const token = body.gitbookToken ?? process.env.GITBOOK_API_TOKEN
  const fileMap = spaceId && token ? await fetchGitbookFiles(spaceId, token) : new Map<string, GbFile>()

  async function insertNode(node: ImportNode, parentId: string | null, parentPath: string | null, order: number) {
    const slug = node.slug
    const path = parentPath ? `${parentPath}/${slug}` : slug
    const kind = node.kind ?? 'document'

    let content: unknown = null
    let title = node.title
    let description: string | null = null

    if (kind === 'document' && node.gbPath) {
      const md = await fetchMarkdown(node.gbPath)
      if (md) {
        const converted = markdownToBlocks(md)
        if (fileMap.size > 0) {
          imagesResolved += await resolveImages(converted.blocks, fileMap, supabase, projectId)
        }
        content = converted.blocks
        if (converted.title) title = converted.title
        if (converted.description) description = converted.description
      } else {
        errors.push(`fetch failed: ${node.gbPath}`)
      }
    }

    const { data: inserted, error } = await supabase
      .from('pages')
      .insert({
        project_id: projectId,
        parent_id: parentId,
        title,
        description,
        slug,
        path,
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: content as any,
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

    // Snapshot an initial published version for the audit trail.
    if (kind === 'document') {
      await supabase.rpc('create_page_version', {
        p_page_id: inserted.id,
        p_is_published: true,
        p_change_summary: 'Imported from GitBook',
      })
    }

    let childOrder = 1000
    for (const child of node.children ?? []) {
      await insertNode(child, inserted.id, path, childOrder)
      childOrder += 1000
    }
  }

  let order = 1000
  for (const node of body.tree) {
    await insertNode(node, null, null, order)
    order += 1000
  }

  return NextResponse.json({ created, imagesResolved, filesIndexed: fileMap.size, errors })
}
