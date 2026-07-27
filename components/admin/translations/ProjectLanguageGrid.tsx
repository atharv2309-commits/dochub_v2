'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Sparkles, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TARGET_LOCALES, getLocaleMeta } from '@/lib/i18n/config'
import { requestTranslations } from '@/app/(admin)/admin/translations/actions'
import { cn } from '@/lib/utils'

export interface LangStat {
  translated: number // up-to-date (machine + reviewed)
  outdated: number
  missing: number
}

// Every language for a project, shown as clickable cards. Clicking opens a
// dialog that translates — by default only the pages that need it (missing +
// out of date), with re-translate-everything as a secondary option. No
// per-project language selection: enabling a language is implicit in
// translating it.
export function ProjectLanguageGrid({
  projectId,
  totalPages,
  stats,
}: {
  projectId: string
  totalPages: number
  stats: Record<string, LangStat> // by locale; missing locales => all-missing
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function statFor(locale: string): LangStat {
    return stats[locale] ?? { translated: 0, outdated: 0, missing: totalPages }
  }

  function translate(locale: string, onlyStale: boolean) {
    setSelected(null)
    startTransition(async () => {
      await requestTranslations(projectId, [locale], onlyStale)
      router.refresh()
    })
  }

  const sel = selected ? statFor(selected) : null
  const selNeeds = sel ? sel.outdated + sel.missing : 0

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TARGET_LOCALES.map((l) => {
          const s = statFor(l.code)
          const needs = s.outdated + s.missing
          const complete = totalPages > 0 && needs === 0
          const started = s.translated > 0 || s.outdated > 0
          const pct = totalPages ? Math.round((s.translated / totalPages) * 100) : 0
          return (
            <button
              key={l.code}
              onClick={() => setSelected(l.code)}
              disabled={pending || totalPages === 0}
              className={cn(
                'group flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                complete
                  ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
                  : started
                    ? 'border-border bg-card hover:bg-secondary/50'
                    : 'border-dashed border-border hover:bg-secondary/40'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium" dir={l.dir}>{l.label}</span>
                {complete ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : s.outdated > 0 ? (
                  <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600 dark:text-amber-500">
                    {s.outdated} stale
                  </span>
                ) : null}
              </div>
              {/* Progress bar */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', complete ? 'bg-emerald-500' : 'bg-primary')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">
                {started ? `${s.translated}/${totalPages} translated` : 'Not started'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Translate dialog for the selected language */}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && sel && (
            <>
              <DialogHeader>
                <DialogTitle>Translate into {getLocaleMeta(selected).label}</DialogTitle>
                <DialogDescription>
                  {sel.translated} translated · {sel.missing} not translated · {sel.outdated} out of
                  date — of {totalPages} published pages.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-2 py-1">
                {selNeeds > 0 ? (
                  <Button
                    onClick={() => translate(selected, true)}
                    className="justify-start gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    Translate {selNeeds} that need it
                    <span className="ml-auto text-xs opacity-80">missing + out of date</span>
                  </Button>
                ) : (
                  <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                    Everything is up to date.
                  </p>
                )}

                <Button
                  variant="outline"
                  onClick={() => translate(selected, false)}
                  className="justify-start gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Re-translate all {totalPages}
                  <span className="ml-auto text-xs text-muted-foreground">replaces existing</span>
                </Button>
              </div>

              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
