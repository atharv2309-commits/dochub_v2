'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Languages, Check, ChevronDown, Loader2 } from 'lucide-react'
import { LOCALES, getLocaleMeta } from '@/lib/i18n/config'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { cn } from '@/lib/utils'

// Switches the locale segment of the current URL and remembers the choice in a
// cookie (so the next locale-less visit lands in the right language). Uses a
// transition so the switch gives *immediate* feedback (spinner + pending row)
// while the new locale's page streams in — the navigation never feels frozen.
export function LanguageSwitcher({
  current,
  available,
}: {
  current: string
  available: string[] // locale codes enabled for this project (incl. source)
}) {
  const router = useRouter()
  const pathname = usePathname()
  const dict = useDict()
  const [open, setOpen] = useState(false)
  const [pendingLocale, setPendingLocale] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Clear the pending marker once the transition (navigation) settles.
  useEffect(() => {
    if (!isPending) setPendingLocale(null)
  }, [isPending])

  // Only render locales the project enabled (preserving canonical order).
  const options = LOCALES.filter((l) => available.includes(l.code))
  if (options.length <= 1) return null

  const targetFor = (code: string) => {
    const parts = pathname.split('/')
    parts[1] = code
    return parts.join('/')
  }

  function choose(code: string) {
    setOpen(false)
    if (code === current) return
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=${60 * 60 * 24 * 365}`
    setPendingLocale(code)
    // startTransition keeps the current page interactive and flips isPending so
    // we can show progress immediately; React swaps in the new route when ready.
    startTransition(() => router.push(targetFor(code)))
  }

  const currentMeta = getLocaleMeta(current)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        aria-label={dict.language.change}
        aria-busy={isPending}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
        <span className="hidden sm:inline">
          {isPending ? dict.language.switching : currentMeta.label}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-44 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
          {options.map((l) => {
            const active = l.code === current
            const pending = l.code === pendingLocale
            return (
              <button
                key={l.code}
                // Prefetch the target locale's page so the swap is near-instant.
                onMouseEnter={() => router.prefetch(targetFor(l.code))}
                onClick={() => choose(l.code)}
                dir={l.dir}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <span>{l.label}</span>
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : active ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
