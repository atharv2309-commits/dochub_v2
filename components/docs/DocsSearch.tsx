'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, FileText, CornerDownLeft, Sparkles, ArrowLeft, Loader2, SendHorizontal, Square } from 'lucide-react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import ReactMarkdown from 'react-markdown'
import { useDict } from '@/components/i18n/DictionaryProvider'
import { cn } from '@/lib/utils'

export interface SearchPage {
  title: string
  path: string
  description: string | null
  text: string
}

type Mode = 'search' | 'ask'

export function DocsSearch({
  pages,
  projectSlug,
  lang,
}: {
  pages: SearchPage[]
  projectSlug: string
  lang: string
}) {
  const dict = useDict()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('search')
  const [query, setQuery] = useState('')
  const [followup, setFollowup] = useState('')
  const [active, setActive] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/ask', body: { projectSlug } }),
    [projectSlug]
  )
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({ transport })
  const busy = status === 'submitted' || status === 'streaming'

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pages.slice(0, 8)
    return pages
      .map((p) => {
        const hay = `${p.title} ${p.description ?? ''} ${p.text}`.toLowerCase()
        const idx = hay.indexOf(q)
        const titleMatch = p.title.toLowerCase().includes(q)
        return { p, score: idx === -1 ? Infinity : idx - (titleMatch ? 1000 : 0) }
      })
      .filter((r) => r.score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map((r) => r.p)
  }, [query, pages])

  // The "Ask AI" row sits at the top of the list whenever there's a query.
  const askRow = query.trim().length > 0
  const selectableCount = (askRow ? 1 : 0) + results.length

  const closePalette = useCallback(() => setOpen(false), [])

  // Reset transient state then open. Done in a handler (not an effect) so we
  // never call setState synchronously inside an effect body.
  const openPalette = useCallback(() => {
    setMode('search')
    setQuery('')
    setFollowup('')
    setActive(0)
    setMessages([])
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 20)
  }, [setMessages])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) closePalette()
        else openPalette()
      }
      if (e.key === 'Escape') closePalette()
    },
    [open, openPalette, closePalette]
  )

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  // Keep the answer scrolled to the latest content while streaming.
  useEffect(() => {
    if (mode === 'ask') answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [messages, mode])

  function go(page: SearchPage) {
    setOpen(false)
    router.push(`/${lang}/docs/${projectSlug}/${page.path}`)
  }

  function startAsk(q: string) {
    const text = q.trim()
    if (!text) return
    setMode('ask')
    setMessages([])
    sendMessage({ text })
  }

  function sendFollowup() {
    const text = followup.trim()
    if (!text || busy) return
    setFollowup('')
    sendMessage({ text })
  }

  function handleListKey(e: React.KeyboardEvent) {
    if (mode !== 'search') return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, selectableCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (askRow && active === 0) {
        startAsk(query)
      } else {
        const page = results[active - (askRow ? 1 : 0)]
        if (page) go(page)
      }
    }
  }

  return (
    <>
      <button
        onClick={openPalette}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-secondary/60 hover:bg-secondary border border-border text-muted-foreground transition-colors w-full max-w-[220px]"
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:block">{dict.search.shortPlaceholder}</span>
        <kbd className="ml-auto hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground/70 font-mono border border-border rounded px-1 py-0.5">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-popover border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleListKey}
          >
            {mode === 'search' ? (
              <>
                <div className="flex items-center gap-3 px-4 border-b border-border">
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setActive(0)
                    }}
                    placeholder={dict.search.placeholder}
                    className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <kbd className="text-[10px] text-muted-foreground/70 font-mono border border-border rounded px-1.5 py-0.5">
                    ESC
                  </kbd>
                </div>

                <div className="overflow-y-auto p-2">
                  {askRow && (
                    <button
                      onClick={() => startAsk(query)}
                      onMouseEnter={() => setActive(0)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-1',
                        active === 0 ? 'bg-primary/10' : 'hover:bg-secondary/60'
                      )}
                    >
                      <Sparkles
                        className={cn('w-4 h-4 shrink-0', active === 0 ? 'text-primary' : 'text-muted-foreground')}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm truncate', active === 0 && 'text-primary')}>
                          {dict.search.askAi}: <span className="text-muted-foreground">“{query}”</span>
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0">↵ to ask</span>
                    </button>
                  )}

                  {results.length === 0 && !askRow ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {dict.search.startTyping}
                    </p>
                  ) : (
                    results.map((page, i) => {
                      const idx = i + (askRow ? 1 : 0)
                      return (
                        <button
                          key={page.path}
                          onClick={() => go(page)}
                          onMouseEnter={() => setActive(idx)}
                          className={cn(
                            'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                            idx === active ? 'bg-primary/10' : 'hover:bg-secondary/60'
                          )}
                        >
                          <FileText
                            className={cn(
                              'w-4 h-4 mt-0.5 shrink-0',
                              idx === active ? 'text-primary' : 'text-muted-foreground'
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm truncate', idx === active && 'text-primary')}>
                              {page.title}
                            </p>
                            {page.description && (
                              <p className="text-xs text-muted-foreground truncate">{page.description}</p>
                            )}
                          </div>
                          {idx === active && (
                            <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <button
                    onClick={() => setMode('search')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={dict.search.backToSearch}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{dict.search.aiAnswer}</span>
                  <kbd className="ml-auto text-[10px] text-muted-foreground/70 font-mono border border-border rounded px-1.5 py-0.5">
                    ESC
                  </kbd>
                </div>

                <div ref={answerRef} className="overflow-y-auto px-4 py-3 space-y-4">
                  {messages.map((m) => {
                    const text = m.parts
                      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                      .map((p) => p.text)
                      .join('')
                    if (m.role === 'user') {
                      return (
                        <p key={m.id} className="text-sm font-medium text-foreground">
                          {text}
                        </p>
                      )
                    }
                    return (
                      <AssistantAnswer
                        key={m.id}
                        text={text}
                        projectSlug={projectSlug}
                        onNavigate={(href) => {
                          setOpen(false)
                          router.push(href)
                        }}
                      />
                    )
                  })}

                  {status === 'submitted' && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Searching the docs…
                    </div>
                  )}
                  {error && (
                    <p className="text-sm text-destructive">{dict.search.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border">
                  <input
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        sendFollowup()
                      }
                    }}
                    placeholder={dict.search.followupPlaceholder}
                    className="flex-1 bg-transparent py-1.5 px-1 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {busy ? (
                    <button
                      onClick={() => stop()}
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                      aria-label={dict.search.stop}
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={sendFollowup}
                      disabled={!followup.trim()}
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
                      aria-label={dict.search.send}
                    >
                      <SendHorizontal className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Legacy GitBook domain the docs were imported from. It is being retired, so any
// link pointing at it must be rewritten to an internal route. Page paths map 1:1
// (docs.flytbase.com/<path> -> /docs/<projectSlug>/<path>).
const LEGACY_DOCS_DOMAIN = 'docs.flytbase.com'

function toInternalHref(href: string, projectSlug: string): string {
  try {
    // base lets relative hrefs parse without throwing; they won't match the host.
    const u = new URL(href, 'http://_local_')
    if (u.hostname !== LEGACY_DOCS_DOMAIN) return href
    const path = u.pathname
      .replace(/^\/+/, '')
      .replace(/^~\/revisions\/[^/]+\//, '') // drop GitBook revision artifacts
      .replace(/\.md$/, '')
    return `/docs/${projectSlug}/${path}${u.hash}`
  } catch {
    return href
  }
}

function AssistantAnswer({
  text,
  projectSlug,
  onNavigate,
}: {
  text: string
  projectSlug: string
  onNavigate: (href: string) => void
}) {
  return (
    <div className="text-sm leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-secondary [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const resolved = href ? toInternalHref(href, projectSlug) : undefined
            const internal = resolved?.startsWith('/')
            return (
              <a
                href={resolved}
                onClick={(e) => {
                  if (internal && resolved) {
                    e.preventDefault()
                    onNavigate(resolved)
                  }
                }}
                target={internal ? undefined : '_blank'}
                rel={internal ? undefined : 'noopener noreferrer'}
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
