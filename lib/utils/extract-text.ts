// Extract plain text from BlockNote JSON content.
// Walks blocks and their inline content + nested children recursively,
// flattening everything into a single space-separated string.
// Used for client-side search indexing and server-side AI retrieval.
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as { content?: unknown; children?: unknown }[]) {
    if (Array.isArray(block.content)) {
      for (const node of block.content as { text?: string }[]) {
        if (typeof node?.text === 'string') parts.push(node.text)
      }
    }
    if (Array.isArray(block.children)) {
      parts.push(extractText(block.children))
    }
  }
  return parts.join(' ')
}
