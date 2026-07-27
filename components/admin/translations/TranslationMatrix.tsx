'use client'

import { useState, useTransition } from 'react'
import { Loader2, RefreshCw, Sparkles, Check, AlertCircle } from 'lucide-react'
import { getLocaleMeta } from '@/lib/i18n/config'
import { requestTranslations } from '@/app/(admin)/admin/translations/actions'
import { ConfirmDialog } from '@/components/admin/translations/ConfirmDialog'
import { cn } from '@/lib/utils'

interface TranslationRow {
  page_id: string
  locale: string
  status: string // 'machine' | 'reviewed' | 'outdated'
  engine: string | null
  translated_at: string
}
interface JobRow {
  id: string
  page_id: string
  locale: string
  status: string
  attempts: number
  error: string | null
  updated_at: string
}
interface PageRow {
  id: string
  title: string
  path: string
}

type CellState = 'missing' | 'machine' | 'reviewed' | 'outdated'

const CELL_STYLE: Record<CellState, string> = {
  reviewed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  machine: 'bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/25',
  outdated: 'bg-amber-500/15 text-amber-600 dark:text-amber-500 border-amber-500/30',
  missing: 'bg-muted/40 text-muted-foreground border-border',
}
const CELL_LABEL: Record<CellState, string> = {
  reviewed: 'Reviewed',
  machine: 'Translated',
  outdated: 'Outdated',
  missing: 'Missing',
}

export function TranslationMatrix({
  projectId,
  enabledLocales,
  pages,
  translations,
  jobs,
}: {
  projectId: string
  enabledLocales: string[]
  pages: PageRow[]
  translations: TranslationRow[]
  jobs: JobRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [action, setAction] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [needsOnly, setNeedsOnly] = useState(false)
  const [confirm, setConfirm] = useState<null | 'missing' | 'all'>(null)

  if (enabledLocales.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No languages enabled for this project yet. Enable one from the{' '}
        <span className="font-medium text-foreground">Translations</span> overview.
      </div>
    )
  }

  const byKey = new Map<string, TranslationRow>()
  for (const t of translations) byKey.set(`${t.page_id}:${t.locale}`, t)

  function cellState(pageId: string, locale: string): CellState {
    const t = byKey.get(`${pageId}:${locale}`)
    if (!t) return 'missing'
    return t.status as CellState
  }

  // Filter the rows so a large project stays scannable: text search by title/path
  // and an "only needs attention" toggle (missing or outdated in any locale).
  const visiblePages = pages.filter((p) => {
    if (query && !`${p.title} ${p.path}`.toLowerCase().includes(query.toLowerCase())) return false
    if (needsOnly) {
      const attention = enabledLocales.some((l) => ['missing', 'outdated'].includes(cellState(p.id, l)))
      if (!attention) return false
    }
    return true
  })

  const activeJobs = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length

  function run(label: string, locales: string[], onlyStale: boolean) {
    setAction(label)
    startTransition(async () => {
      await requestTranslations(projectId, locales, onlyStale)
      setAction(null)
    })
  }

  // Per-locale counts for the header summary.
  function localeCount(locale: string, state: CellState): number {
    return pages.filter((p) => cellState(p.id, locale) === state).length
  }

  return (
    <div className="space-y-6">
      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setConfirm('missing')}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending && action === 'missing' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Translate missing &amp; outdated
        </button>
        <button
          onClick={() => setConfirm('all')}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60 disabled:opacity-60"
        >
          {pending && action === 'all' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Re-translate everything
        </button>
        {activeJobs > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {activeJobs} job{activeJobs === 1 ? '' : 's'} in progress
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter pages…"
          className="h-8 w-56 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => setNeedsOnly((v) => !v)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs transition-colors',
            needsOnly
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-secondary/60'
          )}
        >
          Needs attention
        </button>
        <span className="text-xs text-muted-foreground">
          {visiblePages.length} of {pages.length} pages
        </span>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Page</th>
              {enabledLocales.map((loc) => (
                <th key={loc} className="px-3 py-2.5 text-center font-medium">
                  <div>{getLocaleMeta(loc).label}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {localeCount(loc, 'reviewed') + localeCount(loc, 'machine')}/{pages.length}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePages.map((page) => (
              <tr key={page.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 max-w-xs">
                  <span className="block truncate font-medium">{page.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{page.path}</span>
                </td>
                {enabledLocales.map((loc) => {
                  const state = cellState(page.id, loc)
                  return (
                    <td key={loc} className="px-3 py-2.5 text-center">
                      <span
                        className={cn(
                          'inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium',
                          CELL_STYLE[state]
                        )}
                        title={CELL_LABEL[state]}
                      >
                        {CELL_LABEL[state]}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Job log */}
      {jobs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Recent jobs</h2>
          <div className="space-y-1 rounded-xl border border-border p-2">
            {jobs.slice(0, 12).map((job) => {
              const page = pages.find((p) => p.id === job.page_id)
              const failed = job.status === 'failed'
              return (
                <div
                  key={job.id}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-medium',
                      failed ? 'text-red-500' : job.status === 'done' ? 'text-emerald-500' : 'text-muted-foreground'
                    )}
                  >
                    {failed ? (
                      <AlertCircle className="h-3.5 w-3.5" />
                    ) : job.status === 'done' ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    {job.status}
                  </span>
                  <span className="text-muted-foreground">{getLocaleMeta(job.locale).label}</span>
                  <span className="flex-1 truncate">{page?.title ?? job.page_id}</span>
                  {job.error && <span className="max-w-xs truncate text-red-500/80" title={job.error}>{job.error}</span>}
                  <span className="text-muted-foreground">{new Date(job.updated_at).toLocaleTimeString()}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'all' ? 'Re-translate everything?' : 'Translate missing & outdated?'}
        description={
          confirm === 'all'
            ? `This replaces every existing translation across ${enabledLocales.length} language(s) with fresh machine translations. This can be slow and is usually unnecessary — use it only after a glossary or engine change.`
            : `This queues translations for pages that are missing or out of date across ${enabledLocales.length} language(s). Up-to-date pages are skipped.`
        }
        confirmLabel={confirm === 'all' ? 'Re-translate everything' : 'Translate'}
        onConfirm={() => {
          if (confirm === 'all') run('all', enabledLocales, false)
          else run('missing', enabledLocales, true)
        }}
      />
    </div>
  )
}
