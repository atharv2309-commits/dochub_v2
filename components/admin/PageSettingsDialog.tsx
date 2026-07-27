'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Page } from '@/types/db'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export function PageSettingsDialog({
  page,
  open,
  onOpenChange,
}: {
  page: Page
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const [icon, setIcon] = useState(page.icon ?? '')
  const [cover, setCover] = useState(page.cover_image_url ?? '')
  const [tags, setTags] = useState((page.tags ?? []).join(', '))
  const [hidden, setHidden] = useState(page.hidden)
  const [noIndex, setNoIndex] = useState(page.no_index)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await supabase
      .from('pages')
      .update({
        icon: icon.trim() || null,
        cover_image_url: cover.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        hidden,
        no_index: noIndex,
      })
      .eq('id', page.id)
    setSaving(false)
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Page settings</DialogTitle>
          <DialogDescription className="text-xs">
            Metadata and visibility. Changes apply immediately (not part of the draft).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-[80px_1fr] gap-3 items-center">
            <Label htmlFor="icon">Icon</Label>
            <Input
              id="icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="📄 (emoji)"
              className="text-lg"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cover">Cover image URL</Label>
            <Input
              id="cover"
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              placeholder="https://…"
            />
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="mt-2 h-24 w-full object-cover rounded-md border border-border" />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="guide, setup, getting-started"
            />
            <p className="text-xs text-muted-foreground">Comma-separated.</p>
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm">Hidden</p>
              <p className="text-xs text-muted-foreground">Hide from the docs sidebar and search.</p>
            </div>
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="accent-primary w-4 h-4" />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm">No index</p>
              <p className="text-xs text-muted-foreground">Ask search engines not to index this page.</p>
            </div>
            <input type="checkbox" checked={noIndex} onChange={(e) => setNoIndex(e.target.checked)} className="accent-primary w-4 h-4" />
          </label>

          <div className="space-y-1 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground">Slug (from title): <span className="font-mono text-foreground">{page.slug}</span></p>
            <p className="text-xs text-muted-foreground break-all">Path: <span className="font-mono">{page.path}</span></p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
