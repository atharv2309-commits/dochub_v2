'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { Project, PageWithChildren } from '@/types/db'
import type { SearchPage } from '@/components/docs/DocsSearch'
import { DocsHeader } from '@/components/docs/DocsHeader'
import { DocsSidebar } from '@/components/docs/DocsSidebar'
import { cn } from '@/lib/utils'
import { SOURCE_LOCALE } from '@/lib/i18n/config'

// Responsive shell: sidebar is static on desktop and a slide-in drawer on mobile.
export function DocsShell({
  lang,
  project,
  pageTree,
  searchPages,
  children,
}: {
  lang: string
  project: Project
  pageTree: PageWithChildren[]
  searchPages: SearchPage[]
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close the drawer on navigation.
  useEffect(() => setOpen(false), [pathname])

  // Locales offered in the switcher: source language + the project's targets.
  const availableLocales = [SOURCE_LOCALE, ...(project.enabled_locales ?? [])]

  return (
    <div className="docs-root flex flex-col h-screen bg-background">
      <DocsHeader
        lang={lang}
        availableLocales={availableLocales}
        project={project}
        searchPages={searchPages}
        onMenuToggle={() => setOpen((o) => !o)}
        menuOpen={open}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {open && (
          <div
            className="fixed inset-0 top-14 z-30 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar — drawer on mobile, static column on desktop */}
        <div
          className={cn(
            'z-40 lg:z-auto',
            'fixed lg:static inset-y-0 top-14 lg:top-auto left-0',
            'transition-transform duration-200 lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <DocsSidebar lang={lang} project={project} pageTree={pageTree} />
        </div>

        <main className="flex-1 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  )
}
