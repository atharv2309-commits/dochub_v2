// Shown instantly while a doc page loads (page navigation or language switch),
// so the content area never looks frozen. The cached layout (header + sidebar)
// stays in place; only this content region swaps to the skeleton.
export default function DocPageLoading() {
  return (
    <div className="flex gap-10 max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-10" aria-hidden>
      <div className="flex-1 min-w-0 max-w-3xl animate-pulse">
        {/* breadcrumb */}
        <div className="h-3 w-40 rounded bg-muted mb-6" />
        {/* title */}
        <div className="h-9 w-2/3 rounded bg-muted mb-4" />
        <div className="h-4 w-1/2 rounded bg-muted/70 mb-10" />
        {/* paragraphs */}
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted/60"
              style={{ width: `${[100, 92, 96, 70, 88, 60][i]}%` }}
            />
          ))}
        </div>
        <div className="mt-8 h-40 w-full rounded-lg bg-muted/40" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted/60"
              style={{ width: `${[94, 80, 90, 64][i]}%` }}
            />
          ))}
        </div>
      </div>
      {/* TOC placeholder */}
      <aside className="w-52 flex-shrink-0 hidden xl:block">
        <div className="sticky top-20 space-y-2 animate-pulse">
          <div className="h-3 w-24 rounded bg-muted mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3 rounded bg-muted/60" style={{ width: `${[80, 60, 70, 50, 65][i]}%` }} />
          ))}
        </div>
      </aside>
    </div>
  )
}
