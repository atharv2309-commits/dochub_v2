'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, GitBranchPlus, X } from 'lucide-react'
import { approveSyncEvent, dismissSyncEvent } from '@/app/(admin)/admin/projects/[slug]/actions'

interface Props {
  projectId: string
  eventId: string
  summary: string | null
}

// Webhook-detected pending notification. Never syncs on its own — this is
// the human-approval step for automatic detection (see app/api/webhooks/github).
export function GithubSyncNotice({ projectId, eventId, summary }: Props) {
  const [approving, startApproving] = useTransition()
  const [dismissing, startDismissing] = useTransition()
  const router = useRouter()

  function approve() {
    startApproving(async () => {
      try {
        await approveSyncEvent(projectId, eventId)
        router.refresh()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Sync failed')
      }
    })
  }

  function dismiss() {
    startDismissing(async () => {
      await dismissSyncEvent(projectId, eventId).catch(() => {})
      router.refresh()
    })
  }

  const busy = approving || dismissing

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 mb-6">
      <div className="flex items-center gap-2.5 min-w-0">
        <GitBranchPlus className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">New changes detected on GitHub</p>
          {summary && <p className="text-xs text-muted-foreground truncate">{summary}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={dismiss} disabled={busy}>
          {dismissing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          Dismiss
        </Button>
        <Button size="sm" className="h-8 text-xs" onClick={approve} disabled={busy}>
          {approving ? 'Syncing...' : 'Review & Sync'}
        </Button>
      </div>
    </div>
  )
}
