import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { supabase } from '@/lib/supabase'
import { Readable } from 'stream'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params

  const { data: project } = await supabase
    .from('projects')
    .select('video_url')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // video_url から S3 キーを取得 ("videos/xxx.mp4")
  const url = new URL(project.video_url)
  const key = url.pathname.slice(1)

  const range = request.headers.get('range')

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Range: range ?? undefined,
    })

    const r2Response = await r2.send(command)

    const headers = new Headers()
    headers.set('Content-Type', r2Response.ContentType ?? 'video/mp4')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=3600')
    if (r2Response.ContentLength != null) {
      headers.set('Content-Length', String(r2Response.ContentLength))
    }
    if (r2Response.ContentRange) {
      headers.set('Content-Range', r2Response.ContentRange)
    }

    const nodeReadable = r2Response.Body as Readable
    const webStream = Readable.toWeb(nodeReadable) as ReadableStream

    return new NextResponse(webStream, {
      status: range ? 206 : 200,
      headers,
    })
  } catch (err) {
    console.error('R2 GetObject error:', err)
    return NextResponse.json({ error: 'Failed to retrieve video' }, { status: 500 })
  }
}
