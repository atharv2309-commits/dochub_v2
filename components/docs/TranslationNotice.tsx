import { Languages } from 'lucide-react'
import type { TranslationState } from '@/lib/i18n/load-translation'

// Subtle banner shown when the served content isn't a current translation —
// either no translation exists yet (showing English) or the translation is
// stale and being refreshed. Never shown for 'source' or 'translated'.
export function TranslationNotice({
  state,
  labels,
}: {
  state: TranslationState
  labels: { untranslated: string; outdated: string }
}) {
  if (state === 'source' || state === 'translated') return null

  const message = state === 'untranslated' ? labels.untranslated : labels.outdated

  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
      <Languages className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}
