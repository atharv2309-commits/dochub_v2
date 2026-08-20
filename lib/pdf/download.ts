'use client'

// Fetch a PDF route and trigger a browser download. Shared by any client
// component that offers a "Download as PDF" action (single page, module,
// whole project) — same fetch-blob-and-save dance, just a different URL.
export async function downloadPdf(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('failed to generate PDF')
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}
