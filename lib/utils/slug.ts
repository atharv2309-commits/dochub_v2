export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildPath(parentPath: string | null, slug: string): string {
  if (!parentPath) return slug
  return `${parentPath}/${slug}`
}

// Fractional indexing: generate a key between two values
export function generateOrderBetween(
  before: number | null,
  after: number | null
): number {
  if (before === null && after === null) return 1000
  if (before === null) return (after as number) / 2
  if (after === null) return (before as number) + 1000
  return (before + after) / 2
}
