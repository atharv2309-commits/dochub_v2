'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDict } from '@/components/i18n/DictionaryProvider'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dict = useDict()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Avoid hydration mismatch — render a placeholder until mounted.
  if (!mounted) return <span className="w-8 h-8 shrink-0" />

  const isDark = resolvedTheme === 'dark'
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
      aria-label={isDark ? dict.theme.toLight : dict.theme.toDark}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
