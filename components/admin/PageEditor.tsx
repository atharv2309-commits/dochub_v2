'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Page } from '@/types/db'
import { VersionHistory } from '@/components/admin/VersionHistory'
import { PageSettingsDialog } from '@/components/admin/PageSettingsDialog'
import { PageTranslationStatus } from '@/components/admin/translations/PageTranslationStatus'
import { notifyPagePublished } from '@/app/(admin)/admin/translations/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Globe,
  MoreHorizontal,
  Eye,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Save,
  Send,
  X,
  Trash2,
  FileEdit,
  Settings2,
} from 'lucide-react'

const Editor = dynamic(
  () => import('@/components/editor/Editor').then((m) => m.Editor),
  { ssr: false, loading: () => <div className="animate-pulse h-96 rounded-lg bg-muted" /> }
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blocks = any[]

export function PageEditor({ page, projectSlug }: { page: Page; projectSlug: string }) {
  const router = useRouter()
  const supabase = createClient()
  const [, startTransition] = useTransition()

  // A page has pending (unpublished) changes when a draft snapshot exists.
  const hasDraft = page.draft_content != null
  const isPublished = page.status === 'published'

  // The "working" values shown/edited are the draft if present, else the live page.
  const baseTitle = page.draft_title ?? page.title
  const baseDescription = page.draft_description ?? page.description ?? ''
  const baseContent = (page.draft_content ?? page.content) as Blocks | null

  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [title, setTitle] = useState(baseTitle)
  const [description, setDescription] = useState(baseDescription)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const contentRef = useRef<Blocks | null>(baseContent)

  // When the server data changes (after save / publish / discard + router.refresh),
  // reset all in-memory editing state to the new saved state and remount the editor.
  // This is what makes "Discard" actually drop the draft from the UI (not just the DB).
  const savedSig = `${page.updated_at}|${page.draft_updated_at ?? ''}|${page.status}`
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setTitle(page.draft_title ?? page.title)
    setDescription(page.draft_description ?? page.description ?? '')
    contentRef.current = (page.draft_content ?? page.content) as Blocks | null
    setEditorKey((k) => k + 1)
    setMode('preview')
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSig])

  function enterEdit() {
    setDirty(false)
    setMode('edit')
  }

  function cancelEdit() {
    setTitle(baseTitle)
    setDescription(baseDescription)
    contentRef.current = baseContent
    setEditorKey((k) => k + 1) // remount editor to discard in-memory edits
    setDirty(false)
    setMode('preview')
  }

  async function persistDraft() {
    await supabase
      .from('pages')
      .update({
        draft_title: title.trim() || 'Untitled',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        draft_description: (description.trim() || null) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        draft_content: (contentRef.current ?? []) as any,
        draft_updated_at: new Date().toISOString(),
      })
      .eq('id', page.id)
  }

  async function saveDraft() {
    setSaving(true)
    await persistDraft()
    setSaving(false)
    setDirty(false)
    setMode('preview')
    startTransition(() => router.refresh())
  }

  async function publish() {
    setPublishing(true)
    // Persist any unsaved edits first so the publish captures them.
    if (mode === 'edit') await persistDraft()
    await supabase.rpc('publish_page', { p_page_id: page.id })
    // publish_page enqueues translation jobs for enabled locales; kick the
    // worker so they start processing now (fire-and-forget, won't block).
    notifyPagePublished().catch(() => {})
    setPublishing(false)
    setDirty(false)
    setMode('preview')
    startTransition(() => router.refresh())
  }

  async function discardDraft() {
    if (!confirm('Discard pending draft changes and revert to the published version?')) return
    await supabase
      .from('pages')
      .update({
        draft_content: null,
        draft_title: null,
        draft_description: null,
        draft_updated_at: null,
      })
      .eq('id', page.id)
    startTransition(() => router.refresh())
  }

  const editing = mode === 'edit'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-14 border-b border-border flex items-center px-6 gap-3 flex-shrink-0">
        {/* Status */}
        <StatusBadge editing={editing} isPublished={isPublished} hasDraft={hasDraft} />

        <div className="flex-1" />

        {editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={cancelEdit}
              disabled={saving || publishing}
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={saveDraft}
              disabled={saving || publishing}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save draft
            </Button>
          </>
        ) : (
          <>
            <PageTranslationStatus
              pageId={page.id}
              projectId={page.project_id}
              isPublished={isPublished}
            />
            <VersionHistory pageId={page.id} />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={enterEdit}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
            {(hasDraft || !isPublished) && (
              <Button
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={publish}
                disabled={publishing}
              >
                {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Publish
              </Button>
            )}
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-4 h-4 mr-2" />
              Page settings
            </DropdownMenuItem>
            {isPublished && (
              <DropdownMenuItem asChild>
                <a href={`/docs/${projectSlug}/${page.path}`} target="_blank" rel="noopener noreferrer">
                  <Eye className="w-4 h-4 mr-2" />
                  View published page
                </a>
              </DropdownMenuItem>
            )}
            {hasDraft && isPublished && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={discardDraft}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Discard draft changes
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Pending-draft banner (preview mode, published page with edits) */}
      {!editing && hasDraft && isPublished && (
        <div className="bg-primary/10 border-b border-primary/20 px-6 py-2 flex items-center gap-2 text-xs text-primary">
          <FileEdit className="w-3.5 h-3.5" />
          You&apos;re viewing unpublished draft changes. The live page still shows the last published version — click Publish to make these live.
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 pt-10 pb-24">
          {editing ? (
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
              placeholder="Page title"
              className="w-full font-bold text-4xl bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40 mb-3"
            />
          ) : (
            <h1 className="font-bold text-4xl mb-3">{title || 'Untitled'}</h1>
          )}

          {editing ? (
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setDirty(true) }}
              placeholder="Add a description..."
              className="w-full text-base bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 mb-8"
            />
          ) : (
            description ? <p className="text-base text-muted-foreground mb-8">{description}</p> : <div className="mb-8" />
          )}

          <Separator className="mb-8 opacity-30" />

          <Editor
            key={`${editing ? 'edit' : 'view'}-${editorKey}`}
            pageId={page.id}
            initialContent={baseContent}
            editable={editing}
            onChange={(c) => { contentRef.current = c; setDirty(true) }}
          />
        </div>
      </div>

      <PageSettingsDialog page={page} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function StatusBadge({
  editing,
  isPublished,
  hasDraft,
}: {
  editing: boolean
  isPublished: boolean
  hasDraft: boolean
}) {
  if (editing) {
    return (
      <Badge variant="secondary" className="text-xs gap-1 bg-primary/10 text-primary border-primary/20">
        <Pencil className="w-3 h-3" /> Editing draft
      </Badge>
    )
  }
  if (isPublished && hasDraft) {
    return (
      <Badge variant="secondary" className="text-xs gap-1 bg-primary/10 text-primary border-primary/20">
        <FileEdit className="w-3 h-3" /> Draft changes pending
      </Badge>
    )
  }
  if (isPublished) {
    return (
      <Badge variant="secondary" className="text-xs gap-1 bg-green-500/10 text-green-400 border-green-500/20">
        <CheckCircle2 className="w-3 h-3" /> Published
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-xs gap-1 bg-muted text-muted-foreground">
      <Clock className="w-3 h-3" /> Draft
    </Badge>
  )
}
