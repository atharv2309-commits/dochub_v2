// One-off: translate + merge only the newly-added switcher/linkPreview keys
// into existing locale dictionaries, without re-translating (and risking
// churn on) everything else. Safe to delete after use.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEngine } from '../lib/translation/registry.ts'

function loadEnv() {
  const txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const here = dirname(fileURLToPath(import.meta.url))
const dictDir = resolve(here, '../lib/i18n/dictionaries')
const en = JSON.parse(readFileSync(resolve(dictDir, 'en.json'), 'utf8'))

const NEW_KEYS = [
  ['switcher', 'toReleases'],
  ['switcher', 'toDocs'],
  ['linkPreview', 'loading'],
]
const texts = NEW_KEYS.map(([g, k]) => en[g][k])

const LOCALES = ['es', 'fr', 'de', 'pt', 'nl', 'el', 'sk', 'lv', 'it', 'ja', 'ko', 'ar']

async function main() {
  const engine = getEngine()
  for (const locale of LOCALES) {
    const path = resolve(dictDir, `${locale}.json`)
    const dict = JSON.parse(readFileSync(path, 'utf8'))
    process.stdout.write(`${locale}... `)
    const translated = await engine.translateBatch(texts, { from: 'en', to: locale })
    dict.switcher = { toReleases: translated[0], toDocs: translated[1] }
    dict.linkPreview = { loading: translated[2] }
    writeFileSync(path, JSON.stringify(dict, null, 2) + '\n')
    console.log('done')
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
