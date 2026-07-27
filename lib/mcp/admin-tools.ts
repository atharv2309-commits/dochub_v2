import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from '@/types/database'
import { createServiceClient } from '@/lib/supabase/service'
import { markdownToBlocks } from '@/lib/import/markdownToBlocks'
import { toSlug, buildPath, generateOrderBetween } from '@/lib/utils/slug'
import { logMcpAction } from './audit'
import { getPageTree, getPage, type TreeNode } from './queries'

// Admin, WRITE MCP tools — headless operation of the platform. Reached only after
// the request's API key is verified (see app/api/mcp/admin/route.ts), then run via
// the service-role client. Mutations that must preserve the draft→review→publish
// invariants (publish, rename, restore) go through the mcp_* SECURITY DEFINER
// wrappers, which impersonate the project owner so attribution + ownership checks
// stay correct. Every write is recorded in mcp_audit_log.

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

type SB = ReturnType<typeof createServiceClient>
type PageInsert = Database['public']['Tables']['pages']['Insert']
type PageUpdate = Database['public']['Tables']['pages']['Update']

// The verified API key is delivered to each tool callback via extra.authInfo
// (mcp-handler forwards req.auth → authInfo). verifyAdminKey stashes the key id
// under authInfo.extra.keyId so every write can be attributed in the audit log.
type ToolExtra = { authInfo?: { extra?: { keyId?: string } } }
function keyIdOf(extra: ToolExtra | undefined): string | null {
  return extra?.authInfo?.extra?.keyId ?? null
}

async function resolveProject(
  sb: SB,
  slug: string
): Promise<{ id: string; name: string; user_id: string } | null> {
  const { data } = await sb
    .from('projects')
    .select('id, name, user_id')
    .eq('slug', slug)
    .maybeSingle()
  return (data as { id: string; name: string; user_id: string } | null) ?? null
}

async function resolvePageId(sb: SB, projectId: string, path: string): Promise<string | null> {
  const { data } = await sb
    .from('pages')
    .select('id')
    .eq('project_id', projectId)
    .eq('path', path)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

function rpc(sb: SB) {
  return sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>
}

function flatten(nodes: TreeNode[], out: { title: string; path: string; status: string }[] = []) {
  for (const n of nodes) {
    out.push({ title: n.title, path: n.path, status: n.status })
    flatten(n.children, out)
  }
  return out
}

export function registerAdminTools(server: McpServer): void {
  // ── Discovery ──────────────────────────────────────────────────────────────
  server.registerTool(
    'list_projects',
    {
      title: 'List all projects',
      description: 'List every documentation project (including private/unlisted).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('projects')
        .select('slug, name, description, visibility')
        .order('name')
      const rows = (data as { slug: string; name: string; description: string | null; visibility: string }[] | null) ?? []
      if (!rows.length) return text('No projects exist yet.')
      return text(
        rows
          .map((p) => `- **${p.name}** (\`${p.slug}\`, ${p.visibility})${p.description ? ` — ${p.description}` : ''}`)
          .join('\n')
      )
    }
  )

  server.registerTool(
    'list_pages',
    {
      title: 'List all pages (incl. drafts)',
      description: 'Return the full page tree of a project, including unpublished and hidden pages.',
      inputSchema: { project: z.string().describe('Project slug.') },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const sb = createServiceClient()
      const proj = await resolveProject(sb, project)
      if (!proj) return text(`No project "${project}".`)
      const tree = await getPageTree(sb, proj.id, { includeUnpublished: true })
      const rows = flatten(tree)
      if (!rows.length) return text('No pages.')
      return text(rows.map((r) => `- ${r.title} — \`${r.path}\` (${r.status})`).join('\n'))
    }
  )

  server.registerTool(
    'list_drafts',
    {
      title: 'List pages pending review',
      description:
        'List pages in the review queue: never-published drafts and published pages with ' +
        'pending unpublished edits. Optionally scope to one project.',
      inputSchema: { project: z.string().optional().describe('Optional project slug.') },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const sb = createServiceClient()
      let projId: string | null = null
      if (project) {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        projId = proj.id
      }
      let q = sb
        .from('pages')
        .select('title, path, status, draft_updated_at, project_id')
        .or('status.eq.draft,draft_updated_at.not.is.null')
      if (projId) q = q.eq('project_id', projId)
      const { data } = await q.order('draft_updated_at', { ascending: false })
      const rows = (data as { title: string; path: string; status: string; draft_updated_at: string | null }[] | null) ?? []
      if (!rows.length) return text('Nothing pending review.')
      return text(
        rows
          .map((r) => {
            const state = r.status === 'draft' ? 'unpublished draft' : 'pending edits'
            return `- ${r.title} — \`${r.path}\` (${state})`
          })
          .join('\n')
      )
    }
  )

  server.registerTool(
    'get_page',
    {
      title: 'Read a page (published or draft)',
      description:
        'Read a page as Markdown. Set draft=true to review the pending draft instead of ' +
        'the live published version.',
      inputSchema: {
        project: z.string(),
        path: z.string(),
        draft: z.boolean().optional().describe('Read the pending draft instead of published.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, path, draft }) => {
      const sb = createServiceClient()
      const proj = await resolveProject(sb, project)
      if (!proj) return text(`No project "${project}".`)
      const page = await getPage(sb, proj.id, path, { includeUnpublished: true, draft })
      if (!page) return text(`No page at "${path}".`)
      return text(
        `# ${page.title} (${page.status}${page.hasDraft ? ', has pending draft' : ''})\n\n${page.markdown || '_(empty)_'}`
      )
    }
  )

  // ── Mutations ────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_page',
    {
      title: 'Create a page',
      description:
        'Create a new page as a DRAFT. Provide a title; optionally a parent page path to ' +
        'nest under, a kind (document|group|link), and Markdown body content. The page is ' +
        'not visible publicly until publish_page is called.',
      inputSchema: {
        project: z.string().describe('Project slug.'),
        title: z.string().min(1).describe('Page title.'),
        parent_path: z.string().optional().describe('Path of the parent page to nest under.'),
        kind: z.enum(['document', 'group', 'link']).optional().describe('Default "document".'),
        markdown: z.string().optional().describe('Optional initial body content as Markdown.'),
      },
    },
    async ({ project, title, parent_path, kind, markdown }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)

        let parentId: string | null = null
        let parentPath: string | null = null
        if (parent_path) {
          const { data: parent } = await sb
            .from('pages')
            .select('id, path')
            .eq('project_id', proj.id)
            .eq('path', parent_path)
            .maybeSingle()
          if (!parent) return text(`Parent page "${parent_path}" not found.`)
          parentId = (parent as { id: string }).id
          parentPath = (parent as { path: string }).path
        }

        // Append at the end of the sibling group.
        const sibQ = sb.from('pages').select('order_index').eq('project_id', proj.id)
        const { data: sibs } = await (parentId
          ? sibQ.eq('parent_id', parentId)
          : sibQ.is('parent_id', null)
        ).order('order_index', { ascending: false }).limit(1)
        const lastOrder = (sibs as { order_index: number }[] | null)?.[0]?.order_index ?? null
        const order_index = generateOrderBetween(lastOrder, null)

        const tempSlug = `untitled-${Date.now().toString(36)}`
        const content = markdown ? markdownToBlocks(markdown).blocks : []
        const { data: inserted, error } = await sb
          .from('pages')
          .insert({
            project_id: proj.id,
            parent_id: parentId,
            kind: kind ?? 'document',
            title,
            slug: tempSlug,
            path: buildPath(parentPath, tempSlug),
            content: content as unknown as PageInsert['content'],
            status: 'draft',
            order_index,
            created_by: proj.user_id,
            updated_by: proj.user_id,
          })
          .select('id')
          .single()
        if (error || !inserted) throw new Error(error?.message ?? 'insert failed')

        // Generate a real slug/path from the title via the rename wrapper.
        const { data: newPath, error: rErr } = await rpc(sb)('mcp_rename_page', {
          p_page_id: (inserted as { id: string }).id,
          p_title: title,
        })
        if (rErr) throw new Error(rErr.message)

        const path = (newPath as string) || buildPath(parentPath, toSlug(title))
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'create_page', project, path, args: { title, parent_path, kind } })
        return text(`Created draft page "${title}" at \`${path}\`. Call publish_page to make it live.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'create_page', project, args: { title }, status: 'error', error: msg })
        return text(`Failed to create page: ${msg}`)
      }
    }
  )

  server.registerTool(
    'update_page',
    {
      title: 'Edit a page (saves a draft)',
      description:
        'Update a page\'s title, description, and/or body. Edits are saved as a DRAFT and ' +
        'do NOT change the live page until publish_page is called. Body is given as ' +
        'Markdown; do not include the page title as a leading H1.',
      inputSchema: {
        project: z.string(),
        path: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        markdown: z.string().optional().describe('New body content as Markdown.'),
      },
    },
    async ({ project, path, title, description, markdown }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        const pageId = await resolvePageId(sb, proj.id, path)
        if (!pageId) return text(`No page at "${path}".`)
        if (title === undefined && description === undefined && markdown === undefined) {
          return text('Nothing to update — provide title, description, and/or markdown.')
        }

        const patch: PageUpdate = {
          draft_updated_at: new Date().toISOString(),
          updated_by: proj.user_id,
        }
        if (title !== undefined) patch.draft_title = title
        if (description !== undefined) patch.draft_description = description
        if (markdown !== undefined)
          patch.draft_content = markdownToBlocks(markdown).blocks as unknown as PageUpdate['draft_content']

        const { error } = await sb.from('pages').update(patch).eq('id', pageId)
        if (error) throw new Error(error.message)

        await logMcpAction({ keyId: keyIdOf(extra), tool: 'update_page', project, path, args: { title, description, hasBody: markdown !== undefined } })
        return text(`Saved draft edits to \`${path}\`. Call publish_page to make them live.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'update_page', project, path, status: 'error', error: msg })
        return text(`Failed to update page: ${msg}`)
      }
    }
  )

  server.registerTool(
    'set_page_settings',
    {
      title: 'Update page settings',
      description:
        'Update page metadata that applies immediately (not part of the draft): icon, cover ' +
        'image, tags, hidden (exclude from nav/search), and no_index (SEO).',
      inputSchema: {
        project: z.string(),
        path: z.string(),
        icon: z.string().optional(),
        cover_image_url: z.string().optional(),
        tags: z.array(z.string()).optional(),
        hidden: z.boolean().optional(),
        no_index: z.boolean().optional(),
      },
    },
    async ({ project, path, icon, cover_image_url, tags, hidden, no_index }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        const pageId = await resolvePageId(sb, proj.id, path)
        if (!pageId) return text(`No page at "${path}".`)
        const patch: PageUpdate = { updated_by: proj.user_id }
        if (icon !== undefined) patch.icon = icon || null
        if (cover_image_url !== undefined) patch.cover_image_url = cover_image_url || null
        if (tags !== undefined) patch.tags = tags
        if (hidden !== undefined) patch.hidden = hidden
        if (no_index !== undefined) patch.no_index = no_index
        const { error } = await sb.from('pages').update(patch).eq('id', pageId)
        if (error) throw new Error(error.message)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'set_page_settings', project, path, args: { icon, tags, hidden, no_index } })
        return text(`Updated settings for \`${path}\`.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'set_page_settings', project, path, status: 'error', error: msg })
        return text(`Failed to update settings: ${msg}`)
      }
    }
  )

  server.registerTool(
    'rename_page',
    {
      title: 'Rename a page',
      description:
        'Change a page\'s title. For drafts/auto-named pages this also regenerates the slug ' +
        'and cascades the path to descendants; published pages keep their stable URL.',
      inputSchema: { project: z.string(), path: z.string(), title: z.string().min(1) },
    },
    async ({ project, path, title }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        const pageId = await resolvePageId(sb, proj.id, path)
        if (!pageId) return text(`No page at "${path}".`)
        const { data: newPath, error } = await rpc(sb)('mcp_rename_page', { p_page_id: pageId, p_title: title })
        if (error) throw new Error(error.message)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'rename_page', project, path, args: { title } })
        return text(`Renamed to "${title}". Path is now \`${newPath}\`.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'rename_page', project, path, status: 'error', error: msg })
        return text(`Failed to rename: ${msg}`)
      }
    }
  )

  server.registerTool(
    'publish_page',
    {
      title: 'Publish a page',
      description:
        'Publish a page: apply its pending draft to the live content, snapshot a version, ' +
        'and make it publicly visible. This is the review→publish step.',
      inputSchema: { project: z.string(), path: z.string() },
    },
    async ({ project, path }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        const pageId = await resolvePageId(sb, proj.id, path)
        if (!pageId) return text(`No page at "${path}".`)
        const { error } = await rpc(sb)('mcp_publish_page', { p_page_id: pageId })
        if (error) throw new Error(error.message)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'publish_page', project, path })
        return text(`Published \`${path}\`. It is now live.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'publish_page', project, path, status: 'error', error: msg })
        return text(`Failed to publish: ${msg}`)
      }
    }
  )

  server.registerTool(
    'delete_page',
    {
      title: 'Delete a page',
      description:
        'Permanently delete a page AND all of its nested child pages. This cannot be undone.',
      inputSchema: { project: z.string(), path: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ project, path }, extra) => {
      const sb = createServiceClient()
      try {
        const proj = await resolveProject(sb, project)
        if (!proj) return text(`No project "${project}".`)
        const pageId = await resolvePageId(sb, proj.id, path)
        if (!pageId) return text(`No page at "${path}".`)
        const { error } = await sb.from('pages').delete().eq('id', pageId)
        if (error) throw new Error(error.message)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'delete_page', project, path })
        return text(`Deleted \`${path}\` and any nested pages.`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await logMcpAction({ keyId: keyIdOf(extra), tool: 'delete_page', project, path, status: 'error', error: msg })
        return text(`Failed to delete: ${msg}`)
      }
    }
  )
}
