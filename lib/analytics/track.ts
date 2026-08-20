import type { PageEventType } from '@/types/db'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

interface TrackOpts {
  projectId: string
  pageId?: string
  locale?: string
  queryText?: string
  helpful?: boolean
  comment?: string
}

// Fire-and-forget analytics: a GA4 custom event (only if gtag is loaded, i.e.
// the user accepted the consent banner) plus our own `page_events` log. Never
// throws and never awaited by callers — analytics must never break the reading
// experience.
export function trackEvent(eventType: PageEventType, opts: TrackOpts): void {
  try {
    window.gtag?.('event', eventType, {
      project_id: opts.projectId,
      page_id: opts.pageId,
      locale: opts.locale,
      query_text: opts.queryText,
      helpful: opts.helpful,
    })
  } catch {
    // GA4 unavailable — ignore, this is best-effort.
  }

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType,
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      locale: opts.locale ?? null,
      queryText: opts.queryText ?? null,
      helpful: opts.helpful ?? null,
      comment: opts.comment ?? null,
    }),
    keepalive: true,
  }).catch(() => {})
}
