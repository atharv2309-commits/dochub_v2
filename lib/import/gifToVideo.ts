// Transcode an animated GIF to a web-friendly, looping MP4 (Node-only — uses
// the system ffmpeg). Large screen-recording GIFs (10s–100s of MB) become a
// few MB of H.264, which is dramatically lighter for the docs reader.
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function gifBufferToMp4(buf: Uint8Array): Promise<Uint8Array | null> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'gif2mp4-'))
    const inPath = join(dir, 'in.gif')
    const outPath = join(dir, 'out.mp4')
    await writeFile(inPath, buf)
    // yuv420p + even dimensions for broad browser support; faststart for streaming; drop audio.
    await run('ffmpeg', [
      '-y',
      '-i', inPath,
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-an',
      outPath,
    ], { maxBuffer: 1024 * 1024 * 64 })
    const out = await readFile(outPath)
    return Uint8Array.from(out)
  } catch {
    return null
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
