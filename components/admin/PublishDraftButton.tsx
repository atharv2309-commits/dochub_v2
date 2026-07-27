'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Send, Loader2 } from 'lucide-react'
import { notifyPagePublished } from '@/app/(admin)/admin/translations/actions'

export function PublishDraftButton({ pageId }: { pageId: string }) {
  const [publishing, setPublishing] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function publish() {
    setPublishing(true)
    const { error } = await supabase.rpc('publish_page', { p_page_id: pageId })
    setPublishing(false)
    if (error) {
      alert('Publish failed: ' + error.message)
      return
    }
    // publish_page enqueues translation jobs for enabled locales; kick the
    // worker so they start now (fire-and-forget).
    notifyPagePublished().catch(() => {})
    router.refresh()
  }

  return (
    <Button size="sm" className="gap-1.5 h-8 text-xs shrink-0" onClick={publish} disabled={publishing}>
      {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      Publish
    </Button>
  )
}
