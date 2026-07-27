'use client'

import { useState, useEffect, useRef, useCallback, useTransition } from 'react'
import { Languages, Loader2, Check, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getLocaleMeta } from '@/lib/i18n/config'
import { requestPageTranslation } from '@/app/(admin)/admin/translations/actions'
import { ConfirmDialog } from '@/components/admin/translations/ConfirmDialog'
import { cn } from '@/lib/utils'

type CellState = 'missing' | 'machine' | 'reviewed' | 'outdated'

const STATE_STYLE: Record<CellState, string> = {
  reviewed: 'text-emerald-600 dark:text-emerald-400',
  machine: 'text-blue-600 dark:text-blue-400',
  outdated: 'text-amber-600 dark:text-amber-500',
  missing: 'text-muted-foreground',
}
const STATE_LABEL: Record<CellState, string> = {
  reviewed: 'Reviewed',
  machine: 'Translated',
  outdated: 'Outdated',
  missing: 'Not translated',
}

// Compact per-page translation tracker for the editor toolbar. Shows, at a
// glance, how many of the project's enabled locales this page is translated
// into, and lets the admin (re)translate any locale on the spot — so they can
// track and act without leaving the page. Mirrors enterprise CMS inline status.
export function PageTranslationStatus({
  pageId,
  projectId,
  isPublished,
}: {
  pageId: string
  projectId: string
  isPublished: boolean
}) {
  const [open, setOpen] = useState(false)
  const [locales, setLocales] = useState<string[]>([])
  const [statusByLocale, setStatusByLocale] = useState<Record<string, CellState>>({})
  const [activeLocales, setActiveLocales] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<{
    locales: string[]
    title: string
    description: string
    confirmLabel: string
  } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: project } = await supabase
      .from('projects')
      .select('enabled_locales')
      .eq('id', projectId)
      .single()
    const enabled = project?.enabled_locales ?? []
    setLocales(enabled)

    if (enabled.length) {
      const { data: trs } = await supabase
        .from('page_translations')
        .select('locale, status')
        .eq('page_id', pageId)
      const map: Record<string, CellState> = {}
      for (const l of enabled) map[l] = 'missing'
      for (const t of trs ?? []) map[t.locale] = t.status as CellState
      setStatusByLocale(map)

      const { data: jobs } = await supabase
        .from('translation_jobs')
        .select('locale, status')
        .eq('page_id', pageId)
        .in('status', ['pending', 'running'])
      setActiveLocales(new Set((jobs ?? []).map((j) => j.locale)))
    }
    setLoaded(true)
  }, [pageId, projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Poll while any job for this page is in flight, so the chips advance live.
  useEffect(() => {
    if (activeLocales.size === 0) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [activeLocales, load])

  // No locales enabled for the project → nothing to show.
  if (loaded && locales.length === 0) return null

  const done = locales.filter((l) => ['machine', 'reviewed'].includes(statusByLocale[l])).length
  const needs = locales.filter((l) => ['missing', 'outdated'].includes(statusByLocale[l]))

  function translate(targetLocales: string[]) {
    if (targetLocales.length === 0) return
    setActiveLocales((prev) => new Set([...prev, ...targetLocales]))
    startTransition(async () => {
      await requestPageTranslation(pageId, targetLocales)
      await load()
    })
  }

  // Open a confirmation before triggering, so an accidental click never kicks
  // off translation work. `existing` differentiates a first translation from a
  // retranslate (replacing current content).
  function askTranslate(targetLocales: string[], existing: boolean) {
    if (targetLocales.length === 0) return
    const names = targetLocales.map((l) => getLocaleMeta(l).label).join(', ')
    const multi = targetLocales.length > 1
    setConfirm({
      locales: targetLocales,
      title: existing ? 'Retranslate page?' : 'Translate page?',
      description: existing
        ? `This replaces the current ${multi ? 'translations' : 'translation'} for ${names} with a fresh machine translation.`
        : `This queues a machine translation of this page into ${names}.`,
      confirmLabel: existing ? 'Retranslate' : 'Translate',
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 h-8 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        title="Translation status"
      >
        <Languages className="w-3.5 h-3.5" />
        {!loaded ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <span>
            {done}/{locales.length}
          </span>
        )}
        {activeLocales.size > 0 && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && loaded && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-background p-1.5 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold">Translations</span>
            {needs.length > 0 && (
              <button
                onClick={() => askTranslate(needs, false)}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Translate {needs.length} missing
              </button>
            )}
          </div>

          {!isPublished && (
            <p className="px-2 pb-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              Publish this page to translate it.
            </p>
          )}

          <div className="max-h-72 overflow-y-auto">
            {locales.map((loc) => {
              const state = statusByLocale[loc] ?? 'missing'
              const busy = activeLocales.has(loc)
              const canAct = isPublished && state !== 'reviewed'
              return (
                <div
                  key={loc}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span>{getLocaleMeta(loc).label}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn('inline-flex items-center gap-1 text-[11px]', STATE_STYLE[state])}>
                      {busy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : state === 'reviewed' ? (
                        <Check className="w-3 h-3" />
                      ) : state === 'outdated' ? (
                        <AlertCircle className="w-3 h-3" />
                      ) : null}
                      {busy ? 'Translating…' : STATE_LABEL[state]}
                    </span>
                    {canAct && !busy && (
                      <button
                        onClick={() => askTranslate([loc], state !== 'missing')}
                        disabled={pending}
                        className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
                      >
                        {state === 'missing' ? 'Translate' : 'Retranslate'}
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => {
          if (confirm) translate(confirm.locales)
        }}
      />
    </div>
  )
}
