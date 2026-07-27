'use client'

import Link from 'next/link'
import type { Project } from '@/types/db'
import { DocsSearch, type SearchPage } from '@/components/docs/DocsSearch'
import { ThemeToggle } from '@/components/docs/ThemeToggle'
import { LanguageSwitcher } from '@/components/docs/LanguageSwitcher'
import { McpButton } from '@/components/docs/McpDialog'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { ArrowUpRight, Menu, X } from 'lucide-react'

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
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-4 sm:px-5 gap-3 sm:gap-4 flex-shrink-0 z-50 sticky top-0">
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
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-6 h-6 rounded object-contain" />
        <span className="font-semibold text-sm tracking-tight truncate max-w-[40vw] sm:max-w-none">
          {project.name}
        </span>
      </Link>

      <div className="flex-1" />

      <DocsSearch pages={searchPages} projectSlug={project.slug} lang={lang} />

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
