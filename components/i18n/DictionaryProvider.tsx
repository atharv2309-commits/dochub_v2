'use client'

import { createContext, useContext } from 'react'
import type { Dictionary } from '@/lib/i18n/dictionary'
import en from '@/lib/i18n/dictionaries/en.json'

// Makes the server-resolved UI dictionary available to client chrome components
// without prop-drilling. The dictionary is passed in from a Server Component, so
// during SSR these client components render with the translated strings already
// in place — i.e. the localized chrome is in the indexed HTML, not swapped in
// after hydration.
const DictionaryContext = createContext<Dictionary | null>(null)

export function DictionaryProvider({
  dict,
  children,
}: {
  dict: Dictionary
  children: React.ReactNode
}) {
  return <DictionaryContext.Provider value={dict}>{children}</DictionaryContext.Provider>
}

// Falls back to English when used outside a provider (e.g. admin or print),
// so any component can safely call useDict() without a guard.
export function useDict(): Dictionary {
  return useContext(DictionaryContext) ?? (en as Dictionary)
}
