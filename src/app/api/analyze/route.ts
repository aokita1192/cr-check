import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? ''
const hasValidApiKey = GOOGLE_API_KEY.startsWith('AIza')

function extractBase64(dataUrl: string) {
  return {
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    mediaType: (dataUrl.match(/^data:([^;]+);/) ?? [])[1] ?? 'image/jpeg',
  }
}

function buildDriveDownloadUrl(url: string): string {
  const fileId = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]
  if (!fileId) return url
  if (hasValidApiKey) {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}&supportsAllDrives=true`
  }
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const downloadUrl = buildDriveDownloadUrl(url)

  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(`画像の取得に失敗しました (HTTP ${res.status})`)
  }

  const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'

  if (contentType.includes('text/html')) {
    throw new Error('画像にアクセスできません。Drive ファイルの共有設定を「リンクを知っている全員が閲覧可」にしてください。')
  }

  const mediaType = contentType.split(';')[0].trim()
  const buffer = await res.arrayBuffer()
  const data = Buffer.from(buffer).toString('base64')

  return { data, mediaType }
}

export async function POST(request: NextRequest) {
  try {
    const { frameBase64, refUrl } = await request.json()

    if (!frameBase64 || !refUrl) {
      return NextResponse.json({ error: '動画フレームまたは正解画像URLが不足しています' }, { status: 400 })
    }

    const frame = extractBase64(frameBase64)
    const ref = await fetchImageAsBase64(refUrl)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: frame.mediaType as Anthropic.Base64ImageSource['media_type'],
                data: frame.data,
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: ref.mediaType as Anthropic.Base64ImageSource['media_type'],
                data: ref.data,
              },
            },
            {
              type: 'text',
              text: '1枚目が動画の現在フレーム、2枚目が正解画像（参照車種）です。動画フレームに映っている車種が、正解画像の車種と一致しているかのみを判定してください。画質の劣化・色味の違い・ロゴの表示・映り込みなどは無視してください。一致している場合は「車種一致（OK）」、異なる場合は「車種不一致：[理由を簡潔に]」と日本語で回答してください。',
            },
          ],
        },
      ],
    })

    const resultText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return NextResponse.json({ result: resultText })
  } catch (err) {
    console.error('Analyze error:', err)
    const message = err instanceof Error ? err.message : 'AI分析に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
