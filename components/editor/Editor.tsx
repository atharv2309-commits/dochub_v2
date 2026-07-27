'use client'

import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { filterSuggestionItems } from '@blocknote/core'
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { multiColumnDropCursor } from '@blocknote/xl-multi-column'
import { schema } from './schema'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/shadcn/style.css'
import { createClient } from '@/lib/supabase/client'

interface EditorProps {
  pageId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialContent: any[] | null
  editable: boolean
  // Called with the current document on every change while editing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange?: (content: any[]) => void
}

export function Editor({ pageId, initialContent, editable, onChange }: EditorProps) {
  const supabase = createClient()

  const editor = useCreateBlockNote({
    schema,
    dropCursor: multiColumnDropCursor,
    initialContent: initialContent && initialContent.length > 0 ? initialContent : undefined,
    uploadFile: async (file: File) => {
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `pages/${pageId}/${Date.now()}.${ext}`
      const { data, error } = await supabase.storage
        .from('images')
        .upload(path, file, { contentType: file.type, upsert: false })

      if (error) throw new Error(error.message)
      const { data: urlData } = supabase.storage.from('images').getPublicUrl(data.path)
      return urlData.publicUrl
    },
  })

  function handleChange() {
    if (onChange) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange(editor.document as any[])
    }
  }

  return (
    <div className="w-full blocknote-editor">
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="dark"
        slashMenu={false}
        onChange={handleChange}
        className="min-h-[40vh]"
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                {
                  title: 'Callout',
                  group: 'Custom',
                  icon: <span>💡</span>,
                  hint: 'Insert a callout / alert block',
                  onItemClick: () => {
                    editor.insertBlocks(
                      [{ type: 'callout', props: { type: 'info' } }],
                      editor.getTextCursorPosition().block,
                      'after'
                    )
                  },
                },
              ],
              query
            )
          }
        />
      </BlockNoteView>
    </div>
  )
}
