import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? ''
// Google APIキーは "AIza" で始まる
const hasValidApiKey = GOOGLE_API_KEY.startsWith('AIza')

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function buildDriveUrl(fileId: string): string {
  if (hasValidApiKey) {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}&supportsAllDrives=true`
  }
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
}

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

  const fileId = extractDriveFileId(project.video_url)
  if (!fileId) {
    return NextResponse.json({ error: 'Invalid Drive URL' }, { status: 400 })
  }

  const driveUrl = buildDriveUrl(fileId)
  const range = request.headers.get('range')

  const fetchHeaders: HeadersInit = { 'User-Agent': 'Mozilla/5.0' }
  if (range) fetchHeaders['Range'] = range

  try {
    const driveResponse = await fetch(driveUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    })

    const contentType = driveResponse.headers.get('Content-Type') ?? 'video/mp4'

    if (contentType.includes('text/html')) {
      return NextResponse.json(
        { error: 'このファイルにアクセスできません。Google Drive の共有設定を「リンクを知っている全員が閲覧可」にしてください。' },
        { status: 403 }
      )
    }

    if (!driveResponse.ok && driveResponse.status !== 206) {
      return NextResponse.json(
        { error: `Drive からの取得に失敗しました (HTTP ${driveResponse.status})` },
        { status: driveResponse.status }
      )
    }

    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', contentType)
    responseHeaders.set('Accept-Ranges', 'bytes')
    responseHeaders.set('Cache-Control', 'public, max-age=3600')

    const contentLength = driveResponse.headers.get('Content-Length')
    if (contentLength) responseHeaders.set('Content-Length', contentLength)

    const contentRange = driveResponse.headers.get('Content-Range')
    if (contentRange) responseHeaders.set('Content-Range', contentRange)

    return new NextResponse(driveResponse.body, {
      status: driveResponse.status,
      headers: responseHeaders,
    })
  } catch (err) {
    console.error('Drive proxy error:', err)
    return NextResponse.json({ error: 'Google Drive からの取得に失敗しました' }, { status: 500 })
  }
}
