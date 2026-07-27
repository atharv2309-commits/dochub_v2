import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface NavPage {
  id: string
  title: string
  path: string
}

interface Props {
  prevPage: NavPage | null
  nextPage: NavPage | null
  projectSlug: string
  lang: string
  labels: { previous: string; next: string }
}

export function PageNavigation({ prevPage, nextPage, projectSlug, lang, labels }: Props) {
  if (!prevPage && !nextPage) return null

  return (
    <div className="flex items-center justify-between mt-16 pt-8 border-t border-border">
      {prevPage ? (
        <Link
          href={`/${lang}/docs/${projectSlug}/${prevPage.path}`}
          className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">{labels.previous}</p>
            <p className="font-medium text-foreground">{prevPage.title}</p>
          </div>
        </Link>
      ) : <div />}

      {nextPage ? (
        <Link
          href={`/${lang}/docs/${projectSlug}/${nextPage.path}`}
          className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors text-right"
        >
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">{labels.next}</p>
            <p className="font-medium text-foreground">{nextPage.title}</p>
          </div>
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      ) : <div />}
    </div>
  )
}
