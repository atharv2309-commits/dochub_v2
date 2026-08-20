import { toSlug } from '@/lib/utils/slug'

// Parse a GitBook SUMMARY.md into a page tree. `## Section` headers (no link)
// become unclickable `group` folders; `* [Title](path.md)` items become
// `document` pages, nested by list indentation. Both are relative to the
// physical file layout, which the resulting `mdPath` preserves — so in-body
// relative markdown links between docs keep resolving after import (DocHub's
// page paths end up mirroring the repo's folder structure).

export interface SummaryNode {
  title: string
  slug: string
  kind: 'document' | 'group'
  mdPath?: string // repo-relative path to the source .md file (document only)
  children: SummaryNode[]
}

// README.md is a folder's index page — "readme" is a useless slug, so use the
// enclosing folder's name instead (root README falls back to its title).
function slugFor(mdPath: string, title: string): string {
  const parts = mdPath.split('/')
  const base = parts[parts.length - 1].replace(/\.md$/i, '')
  if (base.toLowerCase() !== 'readme') return toSlug(base) || toSlug(title)
  const folder = parts[parts.length - 2]
  return folder ? toSlug(folder) : toSlug(title)
}

function dedupe(children: SummaryNode[], slug: string): string {
  if (!children.some((c) => c.slug === slug)) return slug
  let i = 2
  while (children.some((c) => c.slug === `${slug}-${i}`)) i++
  return `${slug}-${i}`
}

export function parseGitbookSummary(markdown: string): SummaryNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const root: SummaryNode[] = []
  let currentGroup: SummaryNode | null = null
  const stack: { node: SummaryNode; indent: number }[] = []

  function targetList(indent: number): SummaryNode[] {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    return stack.length ? stack[stack.length - 1].node.children : currentGroup ? currentGroup.children : root
  }

  for (const raw of lines) {
    const h2 = raw.match(/^##\s+(.+?)\s*$/)
    if (h2) {
      const title = h2[1].trim()
      currentGroup = { title, slug: dedupe(root, toSlug(title)), kind: 'group', children: [] }
      root.push(currentGroup)
      stack.length = 0
      continue
    }

    const item = raw.match(/^(\s*)[*-]\s+\[([^\]]*)\]\(([^)]+)\)/)
    if (!item) continue
    const indent = item[1].length
    const title = item[2].trim()
    const target = item[3].trim()
    if (!/\.md$/i.test(target) || /^https?:\/\//i.test(target)) continue

    const siblings = targetList(indent)
    const node: SummaryNode = {
      title,
      slug: dedupe(siblings, slugFor(target, title)),
      kind: 'document',
      mdPath: target,
      children: [],
    }
    siblings.push(node)
    stack.push({ node, indent })
  }

  return root
}
