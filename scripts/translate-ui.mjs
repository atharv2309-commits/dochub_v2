/**
 * Regenerate the UI chrome dictionaries (lib/i18n/dictionaries/*.json) from the
 * English source by machine-translating every string leaf with the configured
 * translation engine.
 *
 * Run:  npx tsx scripts/translate-ui.mjs           (all target locales)
 *       npx tsx scripts/translate-ui.mjs fr de      (just these locales)
 *
 * Env (.env.local): TRANSLATION_ENGINE (optional, defaults to google-free)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEngine } from '../lib/translation/registry.ts'
import { TARGET_LOCALES, SOURCE_LOCALE } from '../lib/i18n/config.ts'

function loadEnv() {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* ignore */
  }
}
loadEnv()

const here = dirname(fileURLToPath(import.meta.url))
const dictDir = resolve(here, '../lib/i18n/dictionaries')
const en = JSON.parse(readFileSync(resolve(dictDir, 'en.json'), 'utf8'))

// Flatten to (path, value) leaf pairs, translate in one batch, rebuild nested.
function flatten(obj, prefix = []) {
  const out = []
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key]
    if (typeof value === 'string') out.push({ path, value })
    else out.push(...flatten(value, path))
  }
  return out
}

function unflatten(leaves, values) {
  const root = {}
  leaves.forEach((leaf, i) => {
    let node = root
    for (const key of leaf.path.slice(0, -1)) {
      node = node[key] ??= {}
    }
    node[leaf.path[leaf.path.length - 1]] = values[i]
  })
  return root
}

async function main() {
  const requested = process.argv.slice(2)
  const locales = requested.length ? TARGET_LOCALES.filter((l) => requested.includes(l.code)) : TARGET_LOCALES

  const leaves = flatten(en)
  const texts = leaves.map((l) => l.value)
  const engine = getEngine()

  for (const locale of locales) {
    process.stdout.write(`Translating UI dictionary -> ${locale.code}... `)
    const translated = await engine.translateBatch(texts, { from: SOURCE_LOCALE, to: locale.code })
    const dict = unflatten(leaves, translated)
    writeFileSync(resolve(dictDir, `${locale.code}.json`), JSON.stringify(dict, null, 2) + '\n')
    console.log('done')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
