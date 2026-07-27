import type { TranslationEngine } from './engine'
import { googleFreeEngine } from './engines/google-free'

// Engine registry. Add new providers here and select via the TRANSLATION_ENGINE
// env var. The rest of the app only calls getEngine() — it never imports a
// concrete engine — so adding "google-cloud" or "claude" means: write the
// engine file, register it below. No other changes.
const ENGINES: Record<string, TranslationEngine> = {
  [googleFreeEngine.id]: googleFreeEngine,
  // 'google-cloud': googleCloudEngine,
  // 'claude': claudeEngine,
}

const DEFAULT_ENGINE_ID = 'google-free'

export function getEngine(id?: string): TranslationEngine {
  const key = id || process.env.TRANSLATION_ENGINE || DEFAULT_ENGINE_ID
  const engine = ENGINES[key]
  if (!engine) {
    throw new Error(
      `Unknown translation engine "${key}". Registered: ${Object.keys(ENGINES).join(', ')}`
    )
  }
  return engine
}
