'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const CONSENT_KEY = 'dochub-analytics-consent'

type Consent = 'accepted' | 'declined'

// GA4 script injection + a lightweight consent banner. The gtag.js script only
// loads after the visitor accepts — trackEvent() checks for window.gtag, so
// declining simply means GA4 events silently no-op while our own page_events
// log (a first-party, non-cookie beacon) keeps working either way.
export function Analytics() {
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined)

  useEffect(() => {
    // Reading localStorage must happen post-hydration (it isn't available
    // during SSR); undefined -> null|accepted|declined is a one-time sync
    // from that external store, not a derived-state anti-pattern.
    const stored = localStorage.getItem(CONSENT_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(stored === 'accepted' || stored === 'declined' ? stored : null)
  }, [])

  if (!GA_ID || consent === undefined) return null

  function choose(value: Consent) {
    localStorage.setItem(CONSENT_KEY, value)
    setConsent(value)
  }

  return (
    <>
      {consent === 'accepted' && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}

      {consent === null && (
        <div className="fixed bottom-0 inset-x-0 z-[60] border-t border-border bg-background/95 backdrop-blur-md px-4 py-3 flex flex-wrap items-center justify-center gap-3 text-sm">
          <p className="text-muted-foreground">We use cookies for analytics.</p>
          <div className="flex gap-2">
            <button
              onClick={() => choose('declined')}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              Decline
            </button>
            <button
              onClick={() => choose('accepted')}
              className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </>
  )
}
