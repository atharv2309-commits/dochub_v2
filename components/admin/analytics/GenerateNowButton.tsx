'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { generateInsights } from '@/app/(admin)/admin/analytics/actions'

export function GenerateNowButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(() => generateInsights(projectId))}
      disabled={pending}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-60 transition-colors"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
      {pending ? 'Generating…' : 'Generate now'}
    </button>
  )
}
