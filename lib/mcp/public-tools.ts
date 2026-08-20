import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAnonClient } from '@/lib/supabase/anon'
import { siteUrlForProject } from '@/lib/site'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'
import { getProject, listProjects, searchDocs, getPageTree, getPage, type TreeNode } from './queries'

// Public, READ-ONLY MCP tools — the "talk to the docs" surface. Every tool runs
// against the anon Supabase client, so RLS makes published/public content the only
// thing reachable. No write tool is registered here, so an LLM cannot even attempt
// a mutation (least privilege by construction, not by annotation).

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

// Cap a single page's rendered body so one huge doc can't blow up the response /
// the caller's context window.
const MAX_PAGE_CHARS = 60_000
function capBody(md: string): string {
  return md.length > MAX_PAGE_CHARS
    ? md.slice(0, MAX_PAGE_CHARS) + '\n\n…(truncated — open the Source URL for the full page)'
    : md
}

/** Canonical public URL for a doc page (used as a citation in every result). */
function docUrl(project: string, path: string): string {
  return `${siteUrlForProject(project)}/${DEFAULT_LOCALE}/docs/${project}/${path}`
}

function renderTree(nodes: TreeNode[], project: string, depth = 0): string {
  let out = ''
  for (const n of nodes) {
    if (n.kind === 'group') {
      out += `${'  '.repeat(depth)}- ${n.icon ? n.icon + ' ' : ''}**${n.title}**\n`
    } else {
      out += `${'  '.repeat(depth)}- ${n.icon ? n.icon + ' ' : ''}${n.title} — \`${n.path}\`\n`
    }
    if (n.children.length) out += renderTree(n.children, project, depth + 1)
  }
  return out
}

export function registerPublicTools(server: McpServer): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List documentation projects',
      description:
        'List all public documentation projects (sites). Use this first to discover ' +
        'which project slug to scope searches and page lookups to.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const sb = createAnonClient()
      const projects = await listProjects(sb)
      if (!projects.length) return text('No public documentation projects are available.')
      const lines = projects.map(
        (p) => `- **${p.name}** (slug: \`${p.slug}\`)${p.description ? ` — ${p.description}` : ''}`
      )
      return text(`Public documentation projects:\n\n${lines.join('\n')}`)
    }
  )

  server.registerTool(
    'search_docs',
    {
      title: 'Search documentation',
      description:
        'Full-text search across published documentation. Returns the most relevant ' +
        'pages with a highlighted snippet and a citation URL. Optionally scope to one ' +
        'project (slug) and/or a tag. Call list_projects first if you need a slug. ' +
        'Then use get_page to read a full page.',
      inputSchema: {
        query: z.string().min(1).describe('Natural-language or keyword search query.'),
        project: z
          .string()
          .optional()
          .describe('Optional project slug to restrict the search. Omit to search all projects.'),
        tag: z.string().optional().describe('Optional tag to filter results.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('Max results (default 8).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, project, tag, limit }) => {
      const sb = createAnonClient()
      const hits = await searchDocs(sb, { query, project, tag, limit })
      if (!hits.length) return text(`No results for "${query}".`)
      const blocks = hits.map((h) => {
        const snippet = (h.snippet ?? h.description ?? '').replace(/\s+/g, ' ').trim()
        return [
          `### ${h.title}`,
          `Project: \`${h.project_slug}\` · Path: \`${h.path}\``,
          snippet ? `> ${snippet}` : '',
          `Source: ${docUrl(h.project_slug, h.path)}`,
        ]
          .filter(Boolean)
          .join('\n')
      })
      return text(
        `Found ${hits.length} result(s) for "${query}". Use get_page with the project slug and path to read the full page.\n\n${blocks.join('\n\n')}`
      )
    }
  )

  server.registerTool(
    'list_pages',
    {
      title: 'List pages in a project',
      description:
        'Return the navigation tree (titles + paths) of a documentation project, so you ' +
        'can browse its structure and pick pages to read. Optionally pass under_path to ' +
        'list only the subtree beneath a given page path.',
      inputSchema: {
        project: z.string().describe('Project slug (from list_projects).'),
        under_path: z
          .string()
          .optional()
          .describe('Optional page path to list only its descendants.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, under_path }) => {
      const sb = createAnonClient()
      const proj = await getProject(sb, project)
      if (!proj) return text(`No public project found with slug "${project}".`)
      const tree = await getPageTree(sb, proj.id, { underPath: under_path })
      if (!tree.length) return text(`No pages found${under_path ? ` under "${under_path}"` : ''}.`)
      return text(`Pages in **${proj.name}**:\n\n${renderTree(tree, project)}`)
    }
  )

  server.registerTool(
    'get_page',
    {
      title: 'Read a documentation page',
      description:
        'Fetch the full content of one documentation page as Markdown, by project slug ' +
        'and page path (paths come from search_docs or list_pages).',
      inputSchema: {
        project: z.string().describe('Project slug.'),
        path: z.string().describe('Page path, e.g. "getting-started/install".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, path }) => {
      const sb = createAnonClient()
      const proj = await getProject(sb, project)
      if (!proj) return text(`No public project found with slug "${project}".`)
      const page = await getPage(sb, proj.id, path)
      if (!page) return text(`No published page found at "${path}" in "${project}".`)
      const header = [
        `# ${page.icon ? page.icon + ' ' : ''}${page.title}`,
        page.description ? `_${page.description}_` : '',
        page.tags.length ? `Tags: ${page.tags.join(', ')}` : '',
        `Source: ${docUrl(project, page.path)}`,
        '',
        '---',
        '',
      ]
        .filter((l) => l !== '')
        .join('\n')
      return text(`${header}\n${capBody(page.markdown) || '_(This page has no body content.)_'}`)
    }
  )
}
