import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { supabase } from '@/lib/supabase'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('video') as File | null

    if (!file) {
      return NextResponse.json({ error: '動画ファイルが見つかりません' }, { status: 400 })
    }

    const projectId = crypto.randomUUID()
    const ext = file.name.split('.').pop() ?? 'mp4'
    const key = `videos/${projectId}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    )

    // 公開URLの構築 (R2_PUBLIC_URLが設定されていない場合はエンドポイントを使用)
    const publicBase = process.env.R2_PUBLIC_URL ?? `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`
    const videoUrl = `${publicBase}/${key}`

    const { error: dbError } = await supabase
      .from('projects')
      .insert({ id: projectId, video_url: videoUrl })

    if (dbError) throw dbError

    return NextResponse.json({ projectId })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: 'アップロードに失敗しました' }, { status: 500 })
  }
}
