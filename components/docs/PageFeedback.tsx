'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Check } from 'lucide-react'
import { trackEvent } from '@/lib/analytics/track'

// "Was this helpful?" — thumbs alone count as complete feedback (fires
// immediately); the optional comment is a second, separate feedback event so
// we never block on it. Styled to match PageActionsMenu's small/unobtrusive
// button conventions.
export function PageFeedback({
  projectId,
  pageId,
  locale,
}: {
  projectId: string
  pageId: string
  locale: string
}) {
  const [voted, setVoted] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)

  function vote(helpful: boolean) {
    if (voted !== null) return
    setVoted(helpful)
    trackEvent('feedback', { projectId, pageId, locale, helpful })
  }

  function submitComment() {
    const text = comment.trim()
    if (!text || sent) return
    trackEvent('feedback', { projectId, pageId, locale, helpful: voted ?? undefined, comment: text })
    setSent(true)
  }

  return (
    <div className="mt-10 pt-6 border-t border-border">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">Was this helpful?</p>
        <button
          onClick={() => vote(true)}
          disabled={voted !== null}
          aria-label="Yes, this was helpful"
          className={`p-1.5 rounded-lg border transition-colors ${
            voted === true
              ? 'border-primary text-primary bg-primary/10'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40'
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => vote(false)}
          disabled={voted !== null}
          aria-label="No, this was not helpful"
          className={`p-1.5 rounded-lg border transition-colors ${
            voted === false
              ? 'border-primary text-primary bg-primary/10'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40'
          }`}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        {voted !== null && !sent && <span className="text-xs text-muted-foreground">Thanks!</span>}
        {sent && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="w-3.5 h-3.5 text-primary" />
            Feedback sent.
          </span>
        )}
      </div>

      {voted !== null && !sent && (
        <div className="mt-3 flex items-start gap-2 max-w-md">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more — optional"
            rows={2}
            className="flex-1 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground resize-none focus:border-primary/50"
          />
          <button
            onClick={submitComment}
            disabled={!comment.trim()}
            className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}
