import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET_NAME = process.env.R2_BUCKET_NAME!

export async function uploadVideoToR2(
  file: File,
  projectId: string
): Promise<string> {
  const extension = file.name.split('.').pop()
  const key = `videos/${projectId}.${extension}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
  )

  // R2のパブリックURLを返す (カスタムドメインまたはエンドポイントから構築)
  const endpoint = process.env.R2_ENDPOINT!
  return `${endpoint}/${BUCKET_NAME}/${key}`
}
