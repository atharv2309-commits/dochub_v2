'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, LayoutGrid, BookText, Settings, FileEdit, Languages, Sparkles } from 'lucide-react'

const NAV = [
  { label: 'Overview', href: '/admin', icon: LayoutGrid },
  { label: 'Projects', href: '/admin', icon: BookText, match: '/admin/projects' },
  { label: 'Drafts', href: '/admin/drafts', icon: FileEdit, match: '/admin/drafts' },
  { label: 'Translations', href: '/admin/translations', icon: Languages, match: '/admin/translations' },
  { label: 'MCP', href: '/admin/mcp', icon: Sparkles, match: '/admin/mcp' },
]

export function AdminHeader({ email }: { email: string }) {
  const pathname = usePathname()
  const initial = email?.[0]?.toUpperCase() ?? 'A'

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-5 gap-4">
      {/* Brand */}
      <Link href="/admin" className="flex items-center gap-2 shrink-0 group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flytbase-icon.png" alt="FlytBase" className="w-7 h-7 rounded-md object-contain" />
        <span className="font-semibold text-sm tracking-tight">FlytBase Docs</span>
      </Link>

      <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

      {/* Nav */}
      <nav className="hidden sm:flex items-center gap-1">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.match ? pathname.startsWith(item.match) : false)
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                active
                  ? 'text-foreground bg-secondary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              )}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex-1" />

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 hover:bg-secondary/60 transition-colors">
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-[#a90901] flex items-center justify-center text-[11px] font-semibold text-white">
              {initial}
            </span>
            <span className="text-xs text-muted-foreground hidden md:block max-w-[140px] truncate">
              {email}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm truncate">{email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="text-destructive focus:text-destructive p-0">
            <form action="/auth/logout" method="POST" className="w-full">
              <button type="submit" className="flex items-center w-full px-2 py-1.5 text-sm">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
