'use client'

import Link from 'next/link'
import type { Project } from '@/types/db'
import { DocsSearch, type SearchPage } from '@/components/docs/DocsSearch'
import { LanguageSwitcher } from '@/components/docs/LanguageSwitcher'
import { McpButton } from '@/components/docs/McpDialog'
import { ThemeToggle } from '@/components/docs/ThemeToggle'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { ArrowUpRight, BookOpen, Menu, Rss, X } from 'lucide-react'

// The two public projects this app hosts today — same pair proxy.ts's
// resolveAlias() hardcodes for the /docs and /releases short URLs. Not
// generalized to N projects; add a real project-picker if that ever changes.
const CROSS_LINK: Record<string, { href: string; labelKey: 'toReleases' | 'toDocs'; icon: typeof Rss }> = {
  'flytbase-docs': { href: '/releases', labelKey: 'toReleases', icon: Rss },
  'flytbase-releases': { href: '/docs', labelKey: 'toDocs', icon: BookOpen },
}

export function DocsHeader({
  lang,
  availableLocales,
  project,
  searchPages,
  onMenuToggle,
  menuOpen,
}: {
  lang: string
  availableLocales: string[]
  project: Project
  searchPages: SearchPage[]
  onMenuToggle?: () => void
  menuOpen?: boolean
}) {
  const dict = useDict()
  return (
    <header className="h-14 border-b border-border bg-background/85 backdrop-blur-xl flex items-center px-4 sm:px-5 gap-3 sm:gap-4 flex-shrink-0 z-50 sticky top-0">
      {/* Mobile menu toggle */}
      {onMenuToggle && (
        <button
          onClick={onMenuToggle}
          className="lg:hidden text-muted-foreground hover:text-foreground p-1 -ml-1"
          aria-label={dict.nav.toggleNavigation}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      )}

      <Link href={`/${lang}/docs/${project.slug}`} className="flex items-center gap-2.5 flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-sm tracking-tight truncate max-w-[40vw] sm:max-w-none">
          {project.name}
        </span>
      </Link>

      <div className="flex-1" />

      <DocsSearch pages={searchPages} projectSlug={project.slug} projectId={project.id} lang={lang} />

      {CROSS_LINK[project.slug] && (
        <Link
          href={`/${lang}${CROSS_LINK[project.slug].href}`}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
        >
          {(() => {
            const Icon = CROSS_LINK[project.slug].icon
            return <Icon className="w-3.5 h-3.5" />
          })()}
          {dict.switcher[CROSS_LINK[project.slug].labelKey]}
        </Link>
      )}

      <McpButton />

      <LanguageSwitcher current={lang} available={availableLocales} />

      <ThemeToggle />

      <a
        href="https://flytbase.com"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden md:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        FlytBase
        <ArrowUpRight className="w-3 h-3" />
      </a>
    </header>
  )
}
