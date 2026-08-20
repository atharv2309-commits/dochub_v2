// Normalize a sharing/watch URL into an embeddable iframe src.
// Returns null for URLs we don't know how to embed (caller can fall back to a link).
export function toEmbedUrl(rawUrl: string): { src: string; provider: string } | null {
  if (!rawUrl) return null
  const url = rawUrl.trim().replace(/^<|>$/g, '')

  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')

    // YouTube
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]
      if (id) return { src: `https://www.youtube.com/embed/${id}`, provider: 'youtube' }
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v')
        if (id) return { src: `https://www.youtube.com/embed/${id}`, provider: 'youtube' }
      }
      if (u.pathname.startsWith('/embed/')) return { src: url, provider: 'youtube' }
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2]
        if (id) return { src: `https://www.youtube.com/embed/${id}`, provider: 'youtube' }
      }
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id && /^\d+$/.test(id)) return { src: `https://player.vimeo.com/video/${id}`, provider: 'vimeo' }
    }
    if (host === 'player.vimeo.com') return { src: url, provider: 'vimeo' }

    // Loom
    if (host === 'loom.com' && u.pathname.startsWith('/share/')) {
      const id = u.pathname.split('/')[2]
      if (id) return { src: `https://www.loom.com/embed/${id}`, provider: 'loom' }
    }
  } catch {
    return null
  }

  return null
}

// True for direct video file URLs that should use a <video> tag.
export function isVideoFile(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)
}

// Extract a YouTube video id from any YouTube URL form.
export function youtubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim().replace(/^<|>$/g, ''))
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null
    }
  } catch {
    return null
  }
  return null
}

// A poster image for a video URL (used in PDF/print where video can't play).
export function videoThumbnail(url: string): string | null {
  const id = youtubeId(url)
  if (id) return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
  return null
}
