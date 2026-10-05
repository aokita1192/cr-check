import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import VideoReviewPanel from '@/components/VideoReviewPanel'

type Props = { params: Promise<{ id: string }> }

function resolveVideoUrl(projectId: string, videoUrl: string): string {
  if (videoUrl.includes('.r2.')) return `/api/video/${projectId}`
  if (/drive\.google\.com\/file\/d\//.test(videoUrl)) return `/api/video-drive/${projectId}`
  return videoUrl // YouTube, Vimeo, MP4直リンク等
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !project) notFound()

  const videoUrl = resolveVideoUrl(id, project.video_url)

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <VideoReviewPanel projectId={id} videoUrl={videoUrl} />
    </main>
  )
}
