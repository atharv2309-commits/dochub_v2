// Splice translated text back into a deep clone of the source document using the
// same path addresses produced by extract.ts. Structure, props, ids, marks, and
// non-translatable fields (code, urls, hrefs) are preserved exactly — only the
// addressed text leaves changed.

// Set a value at a dotted path like "3.content.1.text" within a nested
// array/object structure. Paths only ever reference indices/keys that exist
// (they came from extraction of this same tree), so we just walk and assign.
function setAtPath(root: unknown, path: string, value: string): void {
  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (node == null) return
    node = node[parts[i]]
  }
  if (node != null) node[parts[parts.length - 1]] = value
}

// Build a translated document from the source content and a path->text map.
export function reassemble(
  sourceContent: unknown,
  translations: Map<string, string>
): unknown {
  const clone = structuredClone(sourceContent)
  for (const [path, text] of translations) {
    setAtPath(clone, path, text)
  }
  return clone
}
