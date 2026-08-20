import sharp from 'sharp'

// Imported doc screenshots often come in far larger than they're ever
// displayed at (docs render images at a few hundred px wide; PDF export adds
// 2x for retina — 1600px covers both with headroom). Downsizing oversized
// images is the single biggest lever on Storage egress cost: a 4000px-wide
// screenshot resized to 1600px is roughly a 6x pixel-count (and therefore
// file-size) reduction, before any compression-quality tradeoff.
//
// Deliberately same-format, resize-only — never re-encodes to a different
// container (no PNG->WebP conversion here). That keeps every stored URL's
// extension stable, so this is safe to run on already-referenced images
// without touching a single page's content. Uses sharp (pure JS/native
// bindings, no system binary) rather than shelling out to ffmpeg, since
// ffmpeg isn't reliably available in serverless/production — a cost-control
// feature that silently no-ops in prod defeats the point.
const MAX_WIDTH = 1600

export async function optimizeImage(buf: Uint8Array, ext: string): Promise<Uint8Array> {
  if (ext === 'svg') return buf // vector, already tiny, resizing would be wrong
  try {
    const img = sharp(Buffer.from(buf))
    const meta = await img.metadata()
    if (!meta.width || meta.width <= MAX_WIDTH) return buf // already a sane size
    const resized = await img.resize({ width: MAX_WIDTH, withoutEnlargement: true }).toBuffer()
    // Guard against a pathological case where resizing somehow doesn't shrink
    // the file (e.g. a tiny source with huge metadata) — never ship a bigger asset.
    return resized.byteLength < buf.byteLength ? new Uint8Array(resized) : buf
  } catch {
    return buf // sharp couldn't process it (unsupported/corrupt) — keep the original rather than fail the whole upload
  }
}
