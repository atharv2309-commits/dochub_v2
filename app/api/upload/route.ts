import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const pageId = formData.get('pageId') as string | null

  if (!file || !pageId) {
    return NextResponse.json({ error: 'Missing file or pageId' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()
  const path = `pages/${pageId}/${Date.now()}.${ext}`

  const { data, error } = await supabase.storage
    .from('images')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('images').getPublicUrl(data.path)
  return NextResponse.json({ url: urlData.publicUrl })
}
