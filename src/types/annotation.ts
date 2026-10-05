export type AnnotationCheckResult = {
  text_found: string
  video_format: '縦型' | '横型黒帯' | '横型'
  estimated_px: number
  estimated_pt: number
  min_pt: number
  status: '合格' | '不合格' | '検出不可'
  reason: string
}
