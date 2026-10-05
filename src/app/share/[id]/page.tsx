import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import SharePanel from '@/components/SharePanel'

type Props = { params: Promise<{ id: string }> }

function resolveVideoUrl(projectId: string, videoUrl: string): string {
  if (videoUrl.includes('.r2.')) return `/api/video/${projectId}`
  if (/drive\.google\.com\/file\/d\//.test(videoUrl)) return `/api/video-drive/${projectId}`
  return videoUrl
}

export default async function SharePage({ params }: Props) {
  const { id } = await params

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !project) notFound()

  const { data: comments } = await supabase
    .from('comments')
    .select('*')
    .eq('project_id', id)
    .order('time_sec', { ascending: true })

  const videoUrl = resolveVideoUrl(id, project.video_url)

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SharePanel videoUrl={videoUrl} comments={comments ?? []} />
    </main>
  )
}
