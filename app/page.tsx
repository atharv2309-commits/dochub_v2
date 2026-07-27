import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// The home page is the public documentation entry point.
// It redirects to the first public project's docs. Admin lives at /admin.
export default async function RootPage() {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('slug')
    .eq('visibility', 'public')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (project) {
    redirect(`/docs/${project.slug}`)
  }

  // No public docs exist yet
  notFound()
}
