'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toSlug } from '@/lib/utils/slug'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'

const EMOJI_OPTIONS = ['📚', '📖', '📝', '🚀', '⚡', '🔧', '🎯', '💡', '🛡️', '🌐']

export function CreateProjectDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('📚')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  function handleNameChange(value: string) {
    setName(value)
    if (!slugManuallyEdited) {
      setSlug(toSlug(value))
    }
  }

  function handleSlugChange(value: string) {
    setSlug(toSlug(value))
    setSlugManuallyEdited(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return

    setLoading(true)
    setError(null)

    const { error } = await supabase.from('projects').insert({
      user_id: userId,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
      icon,
    })

    setLoading(false)

    if (error) {
      setError(error.message.includes('unique') ? 'A project with this slug already exists.' : error.message)
      return
    }

    setOpen(false)
    setName('')
    setSlug('')
    setDescription('')
    setIcon('📚')
    setSlugManuallyEdited(false)
    router.push(`/admin/projects/${slug.trim()}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Icon picker */}
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex gap-2 flex-wrap">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors ${
                    icon === emoji
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              placeholder="My Documentation"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-slug">
              Slug
              <span className="text-muted-foreground font-normal ml-1 text-xs">
                (used in URL)
              </span>
            </Label>
            <Input
              id="project-slug"
              placeholder="my-documentation"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-desc">
              Description
              <span className="text-muted-foreground font-normal ml-1 text-xs">(optional)</span>
            </Label>
            <Input
              id="project-desc"
              placeholder="A short description of this project"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name || !slug}>
              {loading ? 'Creating...' : 'Create project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
