'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Plus, Loader2 } from 'lucide-react'
import { addGlossaryTerm, deleteGlossaryTerm } from '@/app/(admin)/admin/translations/actions'
import type { TranslationGlossaryTerm } from '@/types/db'

export function GlossaryManager({ terms }: { terms: TranslationGlossaryTerm[] }) {
  const [term, setTerm] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [adding, startAdding] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const router = useRouter()

  function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!term.trim()) return
    setError(null)
    startAdding(async () => {
      try {
        await addGlossaryTerm(term, notes)
        setTerm('')
        setNotes('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add term')
      }
    })
  }

  async function remove(id: string) {
    setDeletingId(id)
    try {
      await deleteGlossaryTerm(id)
      router.refresh()
    } catch {
      alert('Could not remove that term. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-1">Do-not-translate terms</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Platform UI labels (e.g. &ldquo;Operations Dashboard&rdquo;) that should stay in English
        everywhere, so readers see the exact button/menu name they&apos;ll find in the product —
        never a translated approximation. Applies to every language, on every future translation run.
      </p>

      <form onSubmit={submitAdd} className="flex flex-wrap items-start gap-2 mb-4">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Operations Dashboard"
          className="w-56"
        />
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-56"
        />
        <Button type="submit" size="sm" disabled={adding || !term.trim()} className="gap-1.5">
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add
        </Button>
      </form>
      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      {terms.length === 0 ? (
        <p className="text-xs text-muted-foreground">No terms yet — machine translation runs unrestricted.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{t.term}</span>
                {t.notes && <span className="text-xs text-muted-foreground ml-2">{t.notes}</span>}
              </div>
              <button
                onClick={() => remove(t.id)}
                disabled={deletingId === t.id}
                aria-label={`Remove ${t.term}`}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-60"
              >
                {deletingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
