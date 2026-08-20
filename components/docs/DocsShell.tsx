'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { Project, PageWithChildren } from '@/types/db'
import type { SearchPage } from '@/components/docs/DocsSearch'
import { DocsHeader } from '@/components/docs/DocsHeader'
import { DocsSidebar } from '@/components/docs/DocsSidebar'
import { cn } from '@/lib/utils'
import { SOURCE_LOCALE, getDir } from '@/lib/i18n/config'

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

  // The root <html dir/lang> is set by a Server Component that only runs on a
  // full document load — the language switcher does a client-side navigation,
  // which re-renders this layout (fresh `lang` prop) but never re-runs the
  // root layout above it. Without this, dir/lang stay frozen at whatever
  // locale the tab first loaded, silently mismatching the actual content
  // after every in-app language switch.
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = getDir(lang)
  }, [lang])

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

        {/* Sidebar — drawer on mobile, static column on desktop. `start-0` +
            the `rtl:` variant mean the drawer slides in from the correct edge
            (left in LTR, right in RTL). The transform utilities are scoped to
            `max-lg:` so they never exist at lg+ — `[dir=rtl]` selectors have
            higher CSS specificity than a plain `lg:` class, so without this
            scoping `rtl:translate-x-full` wins the cascade at ANY width and
            pushes the desktop sidebar off-screen in RTL, not just mobile. */}
        <div
          className={cn(
            'z-40 lg:z-auto',
            'fixed lg:static inset-y-0 top-14 lg:top-auto start-0',
            'transition-transform duration-200',
            open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full'
          )}
        >
          <DocsSidebar lang={lang} project={project} pageTree={pageTree} />
        </div>

        <main className="flex-1 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  )
}
