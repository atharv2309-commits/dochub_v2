import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageEditor } from '@/components/admin/PageEditor'

export default async function PageEditorPage({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>
}) {
  const { slug, pageId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: project } = await supabase
    .from('projects')
    .select('id, slug, user_id')
    .eq('slug', slug)
    .eq('user_id', user.id)
    .single()

  if (!project) notFound()

  const { data: page } = await supabase
    .from('pages')
    .select('*')
    .eq('id', pageId)
    .eq('project_id', project.id)
    .single()

  if (!page) notFound()

  return (
    <PageEditor
      page={page}
      projectSlug={slug}
    />
  )
}
