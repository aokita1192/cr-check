'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  Clock, Film, Copy, Check, AlertCircle, Loader2, Trash2, Pencil, X, Home,
  Reply, ClipboardList, ScanLine, Play, Pause, SkipBack, SkipForward, Plus,
} from 'lucide-react'
import type { Comment } from '@/lib/supabase'
import type { DetectResult } from '@/app/api/detect-car/route'
import type { EvidenceCheckResult } from '@/app/api/check-evidence/route'
import type { AnnotationCheckResult } from '@/types/annotation'
import UserMenu from '@/components/UserMenu'

// react-player v3: src プロップ + ref（HTMLVideoElement 互換）。
// next/dynamic は ref を転送しないため、playerRef として渡すラッパーを挟む
type PlayerHandle = { currentTime: number }
type PlayerProps = { src: string; width?: string; height?: string; controls?: boolean; playerRef?: React.Ref<PlayerHandle> }
const ReactPlayer = dynamic<PlayerProps>(
  () => import('react-player').then(m => {
    const RP = m.default as unknown as React.ComponentType<Record<string, unknown>>
    const Wrapped = ({ playerRef, ...rest }: PlayerProps) => <RP ref={playerRef} {...rest} />
    return Wrapped
  }),
  { ssr: false },
)

type Props = { projectId: string; videoUrl: string }
type PlayerMode = 'native' | 'react-player' | 'drive-file' | 'drive-folder'
type Region = { x1: number; y1: number; x2: number; y2: number }

// コメント内容をパース: [REPLY:uuid][C:xxx][R:x1,y1,x2,y2]テキスト
function parseComment(content: string): { text: string; region: Region | null; replyTo: string | null } {
  let rest = content
  let replyTo: string | null = null
  const rm2 = rest.match(/^\[REPLY:([^\]]+)\]/)
  if (rm2) { replyTo = rm2[1]; rest = rest.slice(rm2[0].length) }
  const cm = rest.match(/^\[C:\w+\]/)
  if (cm) rest = rest.slice(cm[0].length)
  let region: Region | null = null
  const rm = rest.match(/^\[R:([\d.,]+)\]/)
  if (rm) {
    const parts = rm[1].split(',').map(Number)
    region = { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] }
    rest = rest.slice(rm[0].length)
  }
  return { text: rest, region, replyTo }
}

function getPlayerMode(url: string): PlayerMode {
  if (url.startsWith('/api/video/') || url.startsWith('/api/video-drive/')) return 'native'
  if (/drive\.google\.com\/(drive\/u?\/?\d*\/?folders|drive\/folders)/.test(url)) return 'drive-folder'
  if (/drive\.google\.com\/file\/d\//.test(url)) return 'drive-file'
  return 'react-player'
}

function getDriveEmbedUrl(url: string): string {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : url
}

function authorName(email: string | null | undefined): string {
  if (!email) return ''
  return email.split('@')[0]
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A87FF]'

type AiTab = 'car' | 'evidence' | 'annotation'
type AiStatus = 'idle' | 'busy' | 'pass' | 'fail' | 'none' | 'error'

function formatTimeMs(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function StatusPill({ s }: { s: AiStatus }) {
  if (s === 'pass') return <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-[#5BE3A0]/15 text-[#5BE3A0] text-xs">合格</span>
  if (s === 'fail') return <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-[#FF6B6B]/15 text-[#FF9A9A] text-xs">不合格</span>
  if (s === 'busy') return <span className="text-xs text-[#B4B9C4]">判定中</span>
  if (s === 'none') return <span className="text-xs text-[#8F95A3]">検出なし</span>
  if (s === 'error') return <span className="text-xs text-[#FF9A9A]">失敗</span>
  return <span className="text-xs text-[#8F95A3]">未実施</span>
}

function ResultBadge({ ok, na }: { ok: boolean | null; na?: string }) {
  if (ok === true) return <span className="inline-flex items-center justify-center gap-1 h-[26px] rounded-full bg-[#5BE3A0]/15 text-[#5BE3A0] text-xs font-bold"><Check className="w-3 h-3" strokeWidth={3} aria-hidden />一致</span>
  if (ok === false) return <span className="inline-flex items-center justify-center gap-1 h-[26px] rounded-full bg-[#FF6B6B]/15 text-[#FF9A9A] text-xs font-bold"><X className="w-3 h-3" strokeWidth={3} aria-hidden />不一致</span>
  return <span className="inline-flex items-center justify-center h-[26px] rounded-full bg-[#1D2027] text-[#B4B9C4] text-xs">{na ?? '対象外'}</span>
}

function Banner({ pass, title, body }: { pass: boolean; title: string; body: string }) {
  const c = pass ? '91,227,160' : '255,107,107'
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: `rgba(${c},.09)`, border: `1px solid rgba(${c},.35)` }}>
      <div className="flex-none w-11 h-11 rounded-full flex items-center justify-center" style={{ background: pass ? '#3DD68C' : '#FF6B6B', color: pass ? '#06281A' : '#2A0808' }}>
        {pass ? <Check className="w-6 h-6" strokeWidth={3} aria-hidden /> : <X className="w-6 h-6" strokeWidth={3} aria-hidden />}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[22px] font-bold leading-tight" style={{ color: pass ? '#5BE3A0' : '#FF9A9A' }}>{title}</span>
        {body && <span className="text-sm text-[#B4B9C4]">{body}</span>}
      </div>
    </div>
  )
}

type CarRow = { label: string; frame: string | null; ref: string | null; ok: boolean | null; na?: string }

type CarResult = DetectResult & { year_match?: boolean | null; mileage_match?: boolean | null }

function buildCarRows(p: CarResult): CarRow[] {
  const vName = p.model ? `${p.maker ?? ''} ${p.model}`.trim() : (p.matched_vehicle ?? p.detected_text)
  const year = p.year ? `${p.year}年式` : null
  const isBid = !!p.frame_diff_claim || (!!p.assessment_date && !p.frame_price && !p.frame_trade)
  const common: CarRow[] = [
    { label: '査定実績ナンバー', frame: null, ref: p.matched_row, ok: null, na: '照合キー' },
    { label: '車種', frame: vName || null, ref: p.matched_vehicle, ok: p.vehicle_match },
    { label: '年式', frame: year, ref: p.year_match ? year : null, ok: p.year_match ?? null, na: p.year_match == null && year ? '未判定' : undefined },
    { label: '走行距離', frame: p.mileage, ref: p.mileage_match ? p.mileage : null, ok: p.mileage_match ?? null, na: p.mileage_match == null && p.mileage ? '未判定' : undefined },
  ]
  if (isBid) {
    return [
      ...common,
      { label: '査定年月', frame: p.assessment_date, ref: null, ok: null },
      { label: '主張差額', frame: p.frame_diff_claim, ref: p.calculated_diff, ok: p.vehicle_match ? p.price_match : null },
    ]
  }
  return [
    ...common,
    { label: '売却価格', frame: p.frame_price, ref: p.sheet_price_sell, ok: p.vehicle_match && p.frame_price ? p.price_match : null },
    { label: '下取り額', frame: p.frame_trade, ref: p.sheet_price_trade, ok: p.vehicle_match && p.frame_trade ? p.price_match : null },
  ]
}

function captureVideoFrame(video: HTMLVideoElement): string | null {
  if (!video || video.videoWidth === 0) return null
  const maxWidth = 800  // 小さくしてトークン削減 → 高速化
  const scale = Math.min(1, maxWidth / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export default function VideoReviewPanel({ projectId, videoUrl }: Props) {
  const mode = getPlayerMode(videoUrl)
  const nativeVideoRef = useRef<HTMLVideoElement>(null)
  const reactPlayerInstance = useRef<PlayerHandle | null>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  const [comments, setComments] = useState<Comment[]>([])
  const [copied, setCopied] = useState(false)
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)

  // 範囲選択アノテーション
  const [annotateMode, setAnnotateMode] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<Region | null>(null)
  const [annotation, setAnnotation] = useState<{
    popupX: number; popupY: number; rect: Region; time: number; text: string
  } | null>(null)
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null)

  // react-player 用
  const [stampedTime, setStampedTime] = useState<number | null>(null)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 横パネルリサイズ（コメント一覧幅）
  const [panelWidth, setPanelWidth] = useState(400)
  const isDraggingH = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(400)

  // 動画プレイヤー状態（カスタムコントロール）
  const [videoError, setVideoError] = useState<string | null>(null)
  const [curTime, setCurTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)

  // AI判定タブ
  const [aiTab, setAiTab] = useState<AiTab>('car')
  const [addedAi, setAddedAi] = useState(false)

  useLayoutEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingH.current) {
        const delta = dragStartX.current - e.clientX
        setPanelWidth(Math.max(220, Math.min(600, dragStartWidth.current + delta)))
      }
    }
    const onUp = () => {
      isDraggingH.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // AI 車種判定
  const [detectingCar, setDetectingCar] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [carDetectResult, setCarDetectResult] = useState<{
    time: number; parsed: DetectResult[] | null; raw: string
  } | null>(null)

  // エビデンス確認
  const [checkingEvidence, setCheckingEvidence] = useState(false)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [evidenceResult, setEvidenceResult] = useState<{
    time: number; parsed: EvidenceCheckResult[] | null
  } | null>(null)

  // 注釈サイズ判定
  const [checkingAnnotation, setCheckingAnnotation] = useState(false)
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [annotationResult, setAnnotationResult] = useState<{
    time: number; parsed: AnnotationCheckResult[] | null
  } | null>(null)

  // コメント返信
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')

  // 全コメントコピー
  const [copiedAll, setCopiedAll] = useState(false)

  const canAIFeatures = mode === 'native'

  const fetchComments = useCallback(async () => {
    const res = await fetch(`/api/comments?project_id=${projectId}`)
    if (res.ok) setComments(await res.json())
  }, [projectId])

  useEffect(() => { fetchComments() }, [fetchComments])

  // コンテナ相対の正規化座標 (0〜1) を返す
  const getContainerCoords = useCallback((e: React.MouseEvent) => {
    const container = videoContainerRef.current
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (!annotateMode || annotation) return
    e.preventDefault()
    const coords = getContainerCoords(e)
    setDragStart(coords)
    setDragRect(null)
  }, [annotateMode, annotation, getContainerCoords])

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart) return
    const coords = getContainerCoords(e)
    setDragRect({
      x1: Math.min(dragStart.x, coords.x),
      y1: Math.min(dragStart.y, coords.y),
      x2: Math.max(dragStart.x, coords.x),
      y2: Math.max(dragStart.y, coords.y),
    })
  }, [dragStart, getContainerCoords])

  const handleOverlayMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragStart || !annotateMode) return
    const container = videoContainerRef.current
    if (!container) return

    const coords = getContainerCoords(e)
    const finalRect: Region = {
      x1: Math.min(dragStart.x, coords.x),
      y1: Math.min(dragStart.y, coords.y),
      x2: Math.max(dragStart.x, coords.x),
      y2: Math.max(dragStart.y, coords.y),
    }

    setDragStart(null)
    setDragRect(null)

    // ドラッグが小さすぎる場合はキャンセル
    if (finalRect.x2 - finalRect.x1 < 0.02 && finalRect.y2 - finalRect.y1 < 0.02) return

    const video = nativeVideoRef.current
    if (video) video.pause()

    const currentTime = video?.currentTime ?? 0
    const cRect = container.getBoundingClientRect()
    const POPUP_W = 296
    const POPUP_H = 220
    const popupX = Math.min(finalRect.x1 * cRect.width, cRect.width - POPUP_W)
    const selBottom = finalRect.y2 * cRect.height
    const selTop = finalRect.y1 * cRect.height
    const spaceBelow = cRect.height - selBottom
    const popupY = spaceBelow >= POPUP_H + 12
      ? selBottom + 12                                   // 選択範囲の下
      : Math.max(8, selTop - POPUP_H - 8)               // 上・最小8pxでクランプ

    setAnnotation({ popupX, popupY, rect: finalRect, time: currentTime, text: '' })
  }, [dragStart, annotateMode, getContainerCoords])

  const handleAnnotationSubmit = useCallback(async () => {
    if (!annotation?.text.trim()) { setAnnotation(null); return }
    const { x1, y1, x2, y2 } = annotation.rect
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        time_sec: annotation.time,
        content: `[C:red][R:${x1.toFixed(3)},${y1.toFixed(3)},${x2.toFixed(3)},${y2.toFixed(3)}]${annotation.text.trim()}`,
      }),
    })
    setAnnotation(null)
    fetchComments()
  }, [annotation, projectId, fetchComments])

  // react-player コメント送信
  const handleStampCurrentTime = () => {
    const time = reactPlayerInstance.current?.currentTime ?? 0
    setStampedTime(Math.floor(time * 10) / 10)
  }

  const handleSubmit = async () => {
    if (!newComment.trim() || stampedTime === null) return
    setSubmitting(true)
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        time_sec: stampedTime,
        content: `[C:red]${newComment.trim()}`,
      }),
    })
    setNewComment('')
    setStampedTime(null)
    setSubmitting(false)
    fetchComments()
  }

  const handleSeek = (sec: number) => {
    if (mode === 'native' && nativeVideoRef.current) nativeVideoRef.current.currentTime = sec
    else if (reactPlayerInstance.current) reactPlayerInstance.current.currentTime = sec
  }

  const handleCopyComment = (e: React.MouseEvent, c: Comment) => {
    e.stopPropagation()
    navigator.clipboard.writeText(parseComment(c.content).text)
    setCopiedCommentId(c.id)
    setTimeout(() => setCopiedCommentId(null), 2000)
  }

  const handleEditStart = useCallback((e: React.MouseEvent, c: Comment) => {
    e.stopPropagation()
    setEditingId(c.id)
    setEditContent(parseComment(c.content).text)
  }, [])

  const handleEditSubmit = useCallback(async (c: Comment) => {
    const { region } = parseComment(c.content)
    const regionPart = region
      ? `[R:${region.x1.toFixed(3)},${region.y1.toFixed(3)},${region.x2.toFixed(3)},${region.y2.toFixed(3)}]`
      : ''
    await fetch('/api/comments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, content: `[C:red]${regionPart}${editContent.trim()}` }),
    })
    setEditingId(null)
    fetchComments()
  }, [editContent, fetchComments])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await fetch(`/api/comments?id=${id}`, { method: 'DELETE' })
    fetchComments()
  }, [fetchComments])

  const handleCheckAnnotation = async () => {
    if (!nativeVideoRef.current) return
    const video = nativeVideoRef.current
    const frameBase64 = captureVideoFrame(video)
    if (!frameBase64) {
      setAnnotationError('動画フレームを取得できませんでした。動画を一時停止してから試してください。')
      return
    }
    setCheckingAnnotation(true)
    setAnnotationError(null)
    setAnnotationResult(null)
    try {
      const res = await fetch('/api/check-annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64, projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '注釈サイズ判定に失敗しました')
      setAnnotationResult({ time: video.currentTime, parsed: data.parsed ?? null })
    } catch (err) {
      setAnnotationError(err instanceof Error ? err.message : '注釈サイズ判定に失敗しました')
    } finally {
      setCheckingAnnotation(false)
    }
  }

  const handleReplySubmit = useCallback(async (parentId: string) => {
    if (!replyText.trim()) return
    const parent = comments.find(c => c.id === parentId)
    if (!parent) return
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        time_sec: parent.time_sec,
        content: `[REPLY:${parentId}][C:red]${replyText.trim()}`,
      }),
    })
    setReplyingToId(null)
    setReplyText('')
    fetchComments()
  }, [replyText, comments, projectId, fetchComments])

  const handleCopyAllComments = () => {
    const topComments = comments
      .filter(c => !parseComment(c.content).replyTo)
      .sort((a, b) => a.time_sec - b.time_sec)
    const lines: string[] = []
    for (const c of topComments) {
      const { text } = parseComment(c.content)
      lines.push(`${formatTime(c.time_sec)} ${text}`)
      const replies = comments
        .filter(r => parseComment(r.content).replyTo === c.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      for (const r of replies) {
        lines.push(`　└ ${parseComment(r.content).text}`)
      }
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const handleCopyUrl = () => {
    const shareUrl = `${window.location.origin}/share/${projectId}`
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDetectCar = async () => {
    if (!nativeVideoRef.current) return
    const video = nativeVideoRef.current
    const frameBase64 = captureVideoFrame(video)
    if (!frameBase64) {
      setDetectError('動画フレームを取得できませんでした。動画を一時停止してから試してください。')
      return
    }
    setDetectingCar(true)
    setDetectError(null)
    setCarDetectResult(null)
    try {
      const res = await fetch('/api/detect-car', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'AI車種判定に失敗しました')
      setCarDetectResult({ time: video.currentTime, parsed: data.parsed ?? null, raw: data.raw ?? '' })
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'AI車種判定に失敗しました')
    } finally {
      setDetectingCar(false)
    }
  }

  const handleCheckEvidence = async () => {
    if (!nativeVideoRef.current) return
    const video = nativeVideoRef.current
    const frameBase64 = captureVideoFrame(video)
    if (!frameBase64) {
      setEvidenceError('動画フレームを取得できませんでした。動画を一時停止してから試してください。')
      return
    }
    setCheckingEvidence(true)
    setEvidenceError(null)
    setEvidenceResult(null)
    try {
      const res = await fetch('/api/check-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64, projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'エビデンス確認に失敗しました')
      setEvidenceResult({ time: video.currentTime, parsed: data.parsed ?? null })
    } catch (err) {
      setEvidenceError(err instanceof Error ? err.message : 'エビデンス確認に失敗しました')
    } finally {
      setCheckingEvidence(false)
    }
  }

  // ホバー中コメントの region
  const hoveredRegion = hoveredCommentId
    ? parseComment(comments.find(c => c.id === hoveredCommentId)?.content ?? '').region
    : null

  // ---- カスタム動画コントロール ----
  const togglePlay = () => {
    const v = nativeVideoRef.current
    if (!v) return
    if (v.paused) void v.play(); else v.pause()
  }
  const stepFrame = (dir: 1 | -1) => {
    const v = nativeVideoRef.current
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / 30))
  }
  const cycleRate = () => {
    const rates = [0.5, 1, 1.5, 2]
    const next = rates[(rates.indexOf(rate) + 1) % rates.length]
    setRate(next)
    if (nativeVideoRef.current) nativeVideoRef.current.playbackRate = next
  }
  // シーク: ドラッグ中は前のシークが終わるまで待ち、最新位置だけを反映する
  // （連続してシークを投げ直すと、完了せず映像が止まって見えるため）
  const scrubbing = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const seekTo = (sec: number) => {
    setCurTime(sec)
    const v = nativeVideoRef.current
    if (!v) return
    if (v.seeking) pendingSeek.current = sec
    else v.currentTime = sec
  }
  const handleSeeked = (v: HTMLVideoElement) => {
    if (pendingSeek.current !== null) {
      const t = pendingSeek.current
      pendingSeek.current = null
      v.currentTime = t
    } else {
      setCurTime(v.currentTime)
    }
  }
  const toggleAnnotate = () => {
    setAnnotateMode(v => !v)
    setAnnotation(null); setDragStart(null); setDragRect(null)
  }

  // ---- AI判定: 現在タブの判定を実行 ----
  const runAi = () => {
    if (aiTab === 'car') void handleDetectCar()
    else if (aiTab === 'evidence') void handleCheckEvidence()
    else void handleCheckAnnotation()
  }
  const aiBusy = aiTab === 'car' ? detectingCar : aiTab === 'evidence' ? checkingEvidence : checkingAnnotation

  const carResults = carDetectResult?.parsed ?? null
  const carPass = carResults ? carResults.every(p => p.vehicle_match && p.price_match !== false) : null
  const evResults = evidenceResult?.parsed ?? null
  const evPass = evResults && evResults.length > 0
    ? evResults.every(r => r.status === '合格' || r.status === '対象外' || r.status === '査定実績で確認')
    : null
  const anResults = annotationResult?.parsed ?? null
  const anPass = anResults && anResults.length > 0 ? anResults.every(a => a.status === '合格') : null

  const tabStatus = (t: AiTab): AiStatus => {
    if (t === 'car') {
      if (detectingCar) return 'busy'
      if (detectError) return 'error'
      if (!carDetectResult) return 'idle'
      return carPass === null ? 'none' : carPass ? 'pass' : 'fail'
    }
    if (t === 'evidence') {
      if (checkingEvidence) return 'busy'
      if (evidenceError) return 'error'
      if (!evidenceResult) return 'idle'
      return evPass === null ? 'none' : evPass ? 'pass' : 'fail'
    }
    if (checkingAnnotation) return 'busy'
    if (annotationError) return 'error'
    if (!annotationResult) return 'idle'
    return anPass === null ? 'none' : anPass ? 'pass' : 'fail'
  }

  const frameTime = aiTab === 'car' ? carDetectResult?.time
    : aiTab === 'evidence' ? evidenceResult?.time : annotationResult?.time

  // 不一致結果をそのまま修正コメントにする
  const addAiComment = async (time: number, text: string) => {
    if (!text.trim()) return
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, time_sec: time, content: `[C:red]${text.trim()}` }),
    })
    setAddedAi(true)
    setTimeout(() => setAddedAi(false), 2000)
    fetchComments()
  }

  const topComments = comments.filter(c => !parseComment(c.content).replyTo)
  const markerPcts = duration > 0
    ? topComments.map(c => Math.min(100, (c.time_sec / duration) * 100))
    : []
  const progressPct = duration > 0 ? Math.min(100, (curTime / duration) * 100) : 0

  const aiCommentDraft = (): { time: number; text: string } | null => {
    if (aiTab === 'car' && carDetectResult && carResults) {
      const lines = carResults.flatMap(p => [
        ...buildCarRows(p).filter(r => r.ok === false)
          .map(r => `【${r.label}】動画「${r.frame ?? '表記なし'}」→ 基準「${r.ref ?? '—'}」`),
        p.reason,
      ]).filter(Boolean)
      return { time: carDetectResult.time, text: lines.join('\n') }
    }
    if (aiTab === 'evidence' && evidenceResult && evResults) {
      const lines = evResults
        .filter(r => !(r.status === '合格' || r.status === '対象外' || r.status === '査定実績で確認'))
        .map(r => `【エビデンス】${r.claim_in_frame}：${r.reason}`)
      return { time: evidenceResult.time, text: lines.join('\n') }
    }
    if (aiTab === 'annotation' && annotationResult && anResults) {
      const lines = anResults.filter(a => a.status !== '合格')
        .map(a => `【注釈サイズ】${a.reason}${a.estimated_px > 0 ? `（推定 ${a.estimated_px}px / 基準 ${a.min_pt}〜${a.max_pt}pt）` : ''}`)
      return { time: annotationResult.time, text: lines.join('\n') }
    }
    return null
  }

  const annotateBtn = (
    <button
      type="button"
      onClick={toggleAnnotate}
      aria-pressed={annotateMode}
      className={`h-11 px-3.5 rounded-[10px] text-sm font-bold inline-flex items-center gap-2 cursor-pointer transition-colors ${FOCUS} ${
        annotateMode ? 'bg-[#FFB020] text-[#1A1200] ring-2 ring-white/40' : 'bg-[#FFB020] text-[#1A1200] hover:bg-[#FFC050]'
      }`}
    >
      <ScanLine className="w-[18px] h-[18px]" aria-hidden />
      {annotateMode ? '範囲選択中' : '範囲コメント'}
    </button>
  )

  const hint = (t: string) => <p className="text-sm text-[#8F95A3]">{t}</p>
  const ghostBtn = `h-9 px-3 rounded-lg border border-[#2A2E37] bg-[#1D2027] text-[#ECEEF2] text-[13px] font-medium hover:bg-[#262A33] disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`

  return (
    <div className="flex flex-col h-screen bg-[#0E0F13] text-[#ECEEF2]">
      <header className="h-14 shrink-0 px-5 flex items-center justify-between border-b border-[#2A2E37] bg-[#16181D]">
        <div className="flex items-center gap-3.5">
          <Link
            href="/"
            aria-label="ホームへ戻る"
            className={`w-9 h-9 rounded-lg border border-[#2A2E37] flex items-center justify-center text-[#B4B9C4] hover:bg-[#1D2027] hover:text-white transition-colors ${FOCUS}`}
          >
            <Home className="w-[18px] h-[18px]" aria-hidden />
          </Link>
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-[#A794FF]" aria-hidden />
            <span className="text-[15px] font-bold">
              動画レビュー
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleCopyUrl} className={`h-9 px-3.5 rounded-lg border border-[#2A2E37] bg-[#16181D] text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#1D2027] ${FOCUS}`}>
            {copied ? <Check className="w-4 h-4 text-[#5BE3A0]" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
            {copied ? 'コピーしました' : 'レビューURLをコピー'}
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* 1: 動画 */}
        <div
          className={`min-w-0 overflow-hidden bg-[#08090B] ${canAIFeatures ? 'lg:w-[clamp(400px,32vw,560px)] lg:flex-none' : 'flex-1'}`}
          style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', minHeight: 0 }}
        >
        {/* プレイヤー */}
        <div
          ref={mode === 'native' ? videoContainerRef : undefined}
          className={`bg-[#08090B] relative overflow-hidden flex items-center justify-center`}
        >
          {/* 動画ネイティブ再生 */}
          {mode === 'native' && (
            <>
              <video
                ref={nativeVideoRef} src={videoUrl} playsInline
                className="w-full h-full" style={{ maxHeight: '100%' }}
                onClick={togglePlay}
                onTimeUpdate={e => { if (!scrubbing.current) setCurTime(e.currentTarget.currentTime) }}
                onSeeked={e => handleSeeked(e.currentTarget)}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
                onDurationChange={e => setDuration(e.currentTarget.duration || 0)}
                onError={() => {
                  // 配信APIのエラー内容（Drive の上限超過など）を取得して表示する
                  fetch(videoUrl, { headers: { Range: 'bytes=0-0' } })
                    .then(r => (r.ok ? null : r.json().catch(() => null)))
                    .then(j => setVideoError(j?.error ?? '動画を読み込めませんでした。時間をおいて再度お試しください。'))
                    .catch(() => setVideoError('動画を読み込めませんでした。通信状況を確認してください。'))
                }}
                onLoadedData={() => setVideoError(null)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />

              {videoError && (
                <div role="alert" className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 p-8 text-center bg-[#08090B]/90">
                  <AlertCircle className="w-10 h-10 text-[#FF9A9A]" aria-hidden />
                  <p className="text-sm text-[#ECEEF2] max-w-xs leading-relaxed">{videoError}</p>
                </div>
              )}

              {/* ホバーコメントの範囲ハイライト（常時表示、pointer-events-none） */}
              {hoveredRegion && (
                <div
                  className="absolute pointer-events-none z-10"
                  style={{
                    left: `${hoveredRegion.x1 * 100}%`,
                    top: `${hoveredRegion.y1 * 100}%`,
                    width: `${(hoveredRegion.x2 - hoveredRegion.x1) * 100}%`,
                    height: `${(hoveredRegion.y2 - hoveredRegion.y1) * 100}%`,
                    border: '2px solid #FFB020',
                    background: 'rgba(255,176,32,0.14)',
                    boxShadow: '0 0 0 1px rgba(255,176,32,0.4)',
                  }}
                />
              )}

              {/* アノテーションモード：ドラッグ入力オーバーレイ */}
              {annotateMode && (
                <div
                  className="absolute inset-x-0 top-0 z-20 select-none"
                  style={{
                    bottom: 0,
                    cursor: 'crosshair',
                    pointerEvents: annotation ? 'none' : 'auto',
                  }}
                  onMouseDown={handleOverlayMouseDown}
                  onMouseMove={handleOverlayMouseMove}
                  onMouseUp={handleOverlayMouseUp}
                  onMouseLeave={() => { setDragStart(null); setDragRect(null) }}
                >
                  {/* ドラッグ中の選択矩形 */}
                  {dragRect && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${dragRect.x1 * 100}%`,
                        top: `${dragRect.y1 * 100}%`,
                        width: `${(dragRect.x2 - dragRect.x1) * 100}%`,
                        height: `${(dragRect.y2 - dragRect.y1) * 100}%`,
                        border: '2px solid #FFB020',
                        background: 'rgba(255,176,32,0.12)',
                      }}
                    />
                  )}
                  {/* ヒント */}
                  {!dragStart && !dragRect && !annotation && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 rounded-full text-xs text-zinc-300 pointer-events-none whitespace-nowrap">
                      ドラッグして指摘箇所を選択
                    </div>
                  )}
                </div>
              )}

              {/* アノテーション確定後：保存した rect のプレビュー */}
              {annotation && (
                <div
                  className="absolute pointer-events-none z-20"
                  style={{
                    left: `${annotation.rect.x1 * 100}%`,
                    top: `${annotation.rect.y1 * 100}%`,
                    width: `${(annotation.rect.x2 - annotation.rect.x1) * 100}%`,
                    height: `${(annotation.rect.y2 - annotation.rect.y1) * 100}%`,
                    border: '2px solid #FFB020',
                    background: 'rgba(255,176,32,0.14)',
                  }}
                />
              )}

              {/* コメント入力ポップアップ */}
              {annotation && (
                <div
                  className="absolute z-30 bg-zinc-900 border border-zinc-600 rounded-xl shadow-2xl w-72"
                  style={{ left: annotation.popupX, top: annotation.popupY }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-zinc-700">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-violet-400" />
                      <span className="text-xs font-mono text-violet-300">{formatTime(annotation.time)}</span>
                      <span className="text-xs text-zinc-600 ml-1">
                        {Math.round((annotation.rect.x2 - annotation.rect.x1) * 100)}×{Math.round((annotation.rect.y2 - annotation.rect.y1) * 100)}%
                      </span>
                    </div>
                    <button onClick={() => setAnnotation(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-3">
                    <textarea
                      autoFocus
                      rows={3}
                      value={annotation.text}
                      onChange={e => setAnnotation({ ...annotation, text: e.target.value })}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={() => setIsComposing(false)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                          e.preventDefault()
                          handleAnnotationSubmit()
                        }
                        if (e.key === 'Escape') setAnnotation(null)
                      }}
                      placeholder="指摘内容を入力..."
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#9A87FF] resize-none"
                    />
                    <button
                      onClick={handleAnnotationSubmit}
                      disabled={!annotation.text.trim()}
                      className="mt-2 w-full py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#6F4CFF] hover:bg-[#7F60FF]"
                    >
                      コメントを追加
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {mode === 'react-player' && (
            <div className="w-full h-full">
              <ReactPlayer src={videoUrl} width="100%" height="100%" controls playerRef={reactPlayerInstance} />
            </div>
          )}
          {mode === 'drive-file' && (
            <div className="w-full h-full flex flex-col">
              <iframe src={getDriveEmbedUrl(videoUrl)} className="flex-1 w-full border-0" allow="autoplay" allowFullScreen />
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-900/30 border-t border-yellow-700/40">
                <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-300">Google Drive はタイムスタンプ・AI機能が使えません</p>
              </div>
            </div>
          )}
          {mode === 'drive-folder' && (
            <div className="flex flex-col items-center gap-4 text-center p-8">
              <AlertCircle className="w-12 h-12 text-red-400" />
              <p className="text-white font-medium">Google Drive フォルダは未対応です</p>
              <p className="text-zinc-400 text-sm max-w-sm">各動画の共有リンクを個別に「URLで追加」から登録してください。</p>
            </div>
          )}
        </div>
        {/* 下部コントロール */}
        <div className="bg-[#16181D]">
          {mode === 'native' && (
            <>
              <div className="h-16 px-5 flex items-center gap-3 bg-[#0E0F13]">
                <span className="font-mono text-[13px] font-medium w-[50px] tabular-nums">{formatTimeMs(curTime)}</span>
                <div className="flex-1 relative h-7 flex items-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#9A87FF] rounded">
                  <div className="absolute inset-x-0 h-2 rounded bg-[#2A2E37]" />
                  <div className="absolute left-0 h-2 rounded bg-[#6F4CFF]" style={{ width: `${progressPct}%` }} />
                  {markerPcts.map((m, i) => (
                    <div key={i} className="absolute top-0 w-[3px] h-3 rounded-sm bg-[#FFB020]" style={{ left: `${m}%` }} />
                  ))}
                  <div className="absolute w-4 h-4 -ml-2 rounded-full bg-white shadow-[0_0_0_3px_rgba(111,76,255,.45)]" style={{ left: `${progressPct}%` }} />
                  <input
                    type="range" aria-label="再生位置"
                    min={0} max={duration || 0} step={0.01} value={Math.min(curTime, duration || 0)}
                    onChange={e => seekTo(Number(e.target.value))}
                    onPointerDown={() => { scrubbing.current = true }}
                    onPointerUp={() => { scrubbing.current = false }}
                    onPointerCancel={() => { scrubbing.current = false }}
                    onBlur={() => { scrubbing.current = false }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <span className="font-mono text-[13px] font-medium text-[#8F95A3] w-10 text-right tabular-nums">{formatTime(duration)}</span>
              </div>
              <div className="h-[72px] px-5 flex items-center gap-2 border-t border-[#2A2E37]">
                <button type="button" aria-label="1コマ戻る" onClick={() => stepFrame(-1)} className={`w-11 h-11 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] flex items-center justify-center hover:bg-[#262A33] ${FOCUS}`}><SkipBack className="w-[18px] h-[18px]" aria-hidden /></button>
                <button type="button" aria-label={playing ? '一時停止' : '再生'} onClick={togglePlay} className={`w-12 h-12 rounded-full bg-[#6F4CFF] text-white flex items-center justify-center hover:bg-[#7F60FF] ${FOCUS}`}>
                  {playing ? <Pause className="w-5 h-5" fill="currentColor" aria-hidden /> : <Play className="w-5 h-5" fill="currentColor" aria-hidden />}
                </button>
                <button type="button" aria-label="1コマ進む" onClick={() => stepFrame(1)} className={`w-11 h-11 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] flex items-center justify-center hover:bg-[#262A33] ${FOCUS}`}><SkipForward className="w-[18px] h-[18px]" aria-hidden /></button>
                <button type="button" aria-label="再生速度" onClick={cycleRate} className={`h-11 px-2.5 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] font-mono text-[13px] font-medium hover:bg-[#262A33] ${FOCUS}`}>{rate.toFixed(1)}×</button>
                <div className="flex-1" />
                {annotateBtn}
              </div>
            </>
          )}

          {mode === 'react-player' && (
            <div className="p-4 border-t border-[#2A2E37]">
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={handleStampCurrentTime} className={`h-10 px-3.5 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] text-sm inline-flex items-center gap-2 hover:bg-[#262A33] ${FOCUS}`}>
                  <Clock className="w-4 h-4 text-[#A794FF]" aria-hidden />現在時刻を記録
                </button>
                {stampedTime !== null && (
                  <span className="flex items-center px-3 rounded-[10px] bg-[#FFB020]/15 text-[#FFB020] text-sm font-mono">{formatTime(stampedTime)}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text" value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onKeyDown={e => { if (e.key === 'Enter' && !isComposing) handleSubmit() }}
                  placeholder={stampedTime === null ? 'まず「現在時刻を記録」してください' : 'コメントを入力...'}
                  disabled={stampedTime === null}
                  aria-label="コメント"
                  className={`flex-1 h-10 rounded-[10px] border border-[#2A2E37] bg-[#0E0F13] px-3 text-sm placeholder:text-[#8F95A3] disabled:opacity-40 ${FOCUS}`}
                />
                <button
                  type="button" onClick={handleSubmit}
                  disabled={!newComment.trim() || stampedTime === null || submitting}
                  className={`h-10 px-4 rounded-[10px] bg-[#6F4CFF] text-white text-sm font-bold hover:bg-[#7F60FF] disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`}
                >追加</button>
              </div>
            </div>
          )}

          {(mode === 'drive-file' || mode === 'drive-folder') && (
            <div className="p-4 border-t border-[#2A2E37]">
              <p className="text-[#8F95A3] text-sm text-center">このプレイヤーではタイムスタンプ機能は使用できません</p>
            </div>
          )}

        </div>
        </div>

        {/* 2: AI判定 */}
        {canAIFeatures && (
          <section className="lg:flex-none lg:w-[clamp(420px,39vw,560px)] min-h-0 px-6 py-5 border-x border-[#2A2E37] bg-[#16181D] flex flex-col gap-4 overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-base font-bold">AI判定</h2>
                <span className="text-[13px] text-[#8F95A3]">{formatTime(frameTime ?? curTime)} のフレーム</span>
              </div>
              <button
                type="button" onClick={runAi} disabled={aiBusy}
                className={`h-10 px-4 rounded-[10px] bg-[#6F4CFF] text-white text-sm font-bold inline-flex items-center gap-2 hover:bg-[#7F60FF] disabled:opacity-60 disabled:cursor-wait ${FOCUS}`}
              >
                {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ScanLine className="w-4 h-4" aria-hidden />}
                {aiBusy ? '判定中...' : 'このフレームを判定'}
              </button>
            </div>

            <div role="tablist" className="flex gap-1 p-1 rounded-xl bg-[#0E0F13] border border-[#2A2E37]">
              {([['car', '車種'], ['evidence', 'エビデンス'], ['annotation', '注釈サイズ']] as [AiTab, string][]).map(([id, label]) => (
                <button
                  key={id} type="button" role="tab" aria-selected={aiTab === id}
                  onClick={() => setAiTab(id)}
                  className={`flex-1 h-10 rounded-lg text-sm flex items-center justify-center gap-2 border ${FOCUS} ${
                    aiTab === id ? 'bg-[#1D2027] border-[#2A2E37] font-bold' : 'border-transparent text-[#B4B9C4] hover:text-white'
                  }`}
                >
                  {label}<StatusPill s={tabStatus(id)} />
                </button>
              ))}
            </div>

            {aiTab === 'car' && (
              <div className="flex flex-col gap-4">
                {detectError && <p role="alert" className="text-sm text-[#FF9A9A]">{detectError}</p>}
                {!carDetectResult && !detectError && hint('動画を一時停止して「このフレームを判定」を押すと、フレーム内のテキストを読み取り車種を照合します')}
                {carDetectResult && !carResults && (
                  <div className="p-3 rounded-xl bg-[#1D2027] border border-[#2A2E37]">
                    <p className="text-sm whitespace-pre-wrap">{carDetectResult.raw}</p>
                  </div>
                )}
                {carResults && carResults.map((p, idx) => {
                  const overall = p.vehicle_match && p.price_match !== false
                  return (
                    <div key={idx} className="flex flex-col gap-3">
                      {carResults.length > 1 && <span className="text-[13px] text-[#8F95A3]">{idx + 1} / {carResults.length}</span>}
                      <Banner pass={overall} title={overall ? '合格' : '不合格'} body={p.reason} />
                      <div className="flex flex-col">
                        <div className="grid grid-cols-[148px_1fr_1fr_84px] gap-3 px-1 pb-2 text-xs text-[#8F95A3]">
                          <span>項目</span><span>動画の表記</span><span>基準（査定実績シート）</span><span>結果</span>
                        </div>
                        {buildCarRows(p).map((r, i, arr) => (
                          <div key={r.label} className={`grid grid-cols-[148px_1fr_1fr_84px] gap-3 items-center min-h-11 px-1 py-1.5 border-t border-[#2A2E37] ${i === arr.length - 1 ? 'border-b' : ''}`}>
                            <span className="text-[#B4B9C4]">{r.label}</span>
                            <span className={r.frame ? 'break-words' : 'text-[#8F95A3]'}>{r.frame ?? '表記なし'}</span>
                            <span className={r.ref ? 'break-words' : 'text-[#8F95A3]'}>{r.ref ?? '—'}</span>
                            <ResultBadge ok={r.ok} na={r.na} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {aiTab === 'evidence' && (
              <div className="flex flex-col gap-3">
                {evidenceError && <p role="alert" className="text-sm text-[#FF9A9A]">{evidenceError}</p>}
                {!evidenceResult && !evidenceError && hint('動画を一時停止して「このフレームを判定」を押すと、フレームの訴求内容をエビデンスリストと照合します')}
                {evidenceResult && evPass === null && hint('このフレームに訴求内容は検出されませんでした')}
                {evPass !== null && <Banner pass={evPass} title={evPass ? '合格' : '不合格'} body="" />}
                {evResults && evResults.map((r, idx) => {
                  const ok = r.status === '合格'
                  const out = r.status === '対象外'
                  const ref = r.status === '査定実績で確認'
                  const tone = ok ? 'text-[#5BE3A0]' : ref ? 'text-[#7AB7FF]' : out ? 'text-[#B4B9C4]' : 'text-[#FF9A9A]'
                  return (
                    <div key={idx} className="rounded-xl border border-[#2A2E37] bg-[#1D2027] overflow-hidden">
                      <div className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-[#2A2E37]">
                        <span className={`text-sm font-bold ${tone}`}>{r.status}</span>
                        <span className="text-sm flex-1">{r.claim_in_frame}</span>
                        {r.evidence_no && <span className="text-xs font-mono text-[#FFB020] bg-[#FFB020]/10 px-1.5 py-0.5 rounded">{r.evidence_no}</span>}
                      </div>
                      <div className="px-3.5 py-2.5 flex flex-col gap-1 text-[13px]">
                        {r.evidence_no && (
                          <div className="flex gap-3"><span className="text-[#8F95A3] w-16 shrink-0">区分</span>
                            <span>{r.evidence_category === 'A' ? 'A：根拠＋注釈が必要' : r.evidence_category === 'B' ? 'B：根拠のみ必要' : r.evidence_category === 'C' ? 'C：根拠・注釈不要' : r.evidence_category ?? '—'}</span></div>
                        )}
                        {r.expiry_date && (
                          <div className="flex gap-3"><span className="text-[#8F95A3] w-16 shrink-0">使用期限</span>
                            <span className={r.is_expired ? 'text-[#FF9A9A]' : ''}>{r.expiry_date}{r.is_expired ? '（期限切れ）' : '（有効）'}</span></div>
                        )}
                        <p className={tone}>{r.reason}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {aiTab === 'annotation' && (
              <div className="flex flex-col gap-3">
                {annotationError && <p role="alert" className="text-sm text-[#FF9A9A]">{annotationError}</p>}
                {!annotationResult && !annotationError && hint('動画を一時停止して「このフレームを判定」を押すと、フレーム内の注釈テキストサイズを判定します（合格基準：動画 16〜20px）')}
                {annotationResult && anPass === null && hint('このフレームに注釈テキストは検出されませんでした')}
                {anPass !== null && <Banner pass={anPass} title={anPass ? '合格' : '不合格'} body="" />}
                {anResults && anResults.map((a, idx) => {
                  const ok = a.status === '合格'
                  const unk = a.status === '検出不可'
                  return (
                    <div key={idx} className="rounded-xl border border-[#2A2E37] bg-[#1D2027] overflow-hidden">
                      <div className="px-3.5 py-2.5 flex items-center gap-2 border-b border-[#2A2E37]">
                        <span className={`text-sm font-bold ${ok ? 'text-[#5BE3A0]' : unk ? 'text-[#B4B9C4]' : 'text-[#FF9A9A]'}`}>{a.status}</span>
                        <span className="text-xs text-[#8F95A3] ml-auto">{a.video_format}</span>
                      </div>
                      <div className="px-3.5 py-2.5 flex flex-col gap-1.5 text-[13px]">
                        {a.text_found && <div className="flex gap-3"><span className="text-[#8F95A3] w-24 shrink-0">検出テキスト</span><span>{a.text_found}</span></div>}
                        {a.estimated_pt > 0 && (
                          <>
                            <div className="flex gap-3"><span className="text-[#8F95A3] w-24 shrink-0">推定サイズ</span><span className={`font-mono font-bold ${ok ? 'text-[#5BE3A0]' : 'text-[#FF9A9A]'}`}>約 {a.estimated_pt}pt（{a.estimated_px}px）</span></div>
                            <div className="flex gap-3"><span className="text-[#8F95A3] w-24 shrink-0">合格ライン</span><span className="font-mono">{a.min_pt}〜{a.max_pt}pt（動画 16〜20px）</span></div>
                            {!ok && a.estimated_px > 0 && (
                              <p className="text-[#FFB020]">{a.estimated_px < 16 ? `→ 編集ソフトで ${a.min_pt}〜${a.max_pt}pt に引き上げてください` : '→ 注釈以外の要素を誤検出している可能性があります'}</p>
                            )}
                          </>
                        )}
                        <p className={ok ? 'text-[#5BE3A0]' : unk ? 'text-[#8F95A3]' : 'text-[#FF9A9A]'}>{a.reason}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="text-[13px] text-[#8F95A3]">不一致があれば、結果をそのまま修正コメントにできます</span>
              <button
                type="button"
                disabled={tabStatus(aiTab) !== 'fail'}
                onClick={() => { const c = aiCommentDraft(); if (c) void addAiComment(c.time, c.text) }}
                className={`${ghostBtn} shrink-0 inline-flex items-center gap-1.5`}
              >
                {addedAi ? <><Check className="w-4 h-4 text-[#5BE3A0]" aria-hidden />追加しました</> : <><Plus className="w-4 h-4" aria-hidden />コメントに追加</>}
              </button>
            </div>
          </section>
        )}
      {/* リサイズハンドル */}
      <div
        className={`hidden ${canAIFeatures ? '' : 'lg:flex'} items-center justify-center w-1.5 bg-[#2A2E37] hover:bg-[#6F4CFF] cursor-col-resize shrink-0 transition-colors`}
        onMouseDown={e => {
          e.preventDefault()
          isDraggingH.current = true
          dragStartX.current = e.clientX
          dragStartWidth.current = panelWidth
          document.body.style.cursor = 'col-resize'
        }}
      />

      {/* 3: コメント */}
      <aside
        className={`w-full min-h-0 flex flex-col bg-[#16181D] ${canAIFeatures ? 'lg:flex-1 lg:min-w-[320px]' : 'lg:w-[var(--pw)] lg:flex-none'}`}
        style={{ '--pw': `${panelWidth}px` } as React.CSSProperties}
      >
        <div className="h-[52px] shrink-0 px-4 flex items-center gap-2 border-b border-[#2A2E37]">
          <h2 className="text-base font-bold">修正コメント</h2>
          <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#6F4CFF] text-white text-xs inline-flex items-center justify-center">{topComments.length}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
          {topComments.length === 0 ? (
            <p className="text-[#8F95A3] text-sm text-center mt-8">コメントはまだありません</p>
          ) : (
            [...topComments]
              .sort((a, b) => a.time_sec - b.time_sec)
              .map(c => {
                const { text, region } = parseComment(c.content)
                const selected = hoveredCommentId === c.id
                const replies = comments
                  .filter(r => parseComment(r.content).replyTo === c.id)
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                const actBtn = 'p-1.5 rounded-md hover:bg-[#2A2E37] text-[#B4B9C4] hover:text-white ' + FOCUS
                return (
                  <div key={c.id}>
                    <div
                      onClick={() => { if (editingId !== c.id) handleSeek(c.time_sec) }}
                      onDoubleClick={e => handleEditStart(e, c)}
                      onMouseEnter={() => setHoveredCommentId(c.id)}
                      onMouseLeave={() => setHoveredCommentId(null)}
                      className={`group p-3.5 rounded-xl flex flex-col gap-2.5 transition-colors cursor-pointer ${
                        selected || editingId === c.id
                          ? 'bg-[#FFB020]/[.08] border-[1.5px] border-[#FFB020]'
                          : 'bg-[#1D2027] border border-[#2A2E37] hover:border-[#3A3F4B]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {(
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleSeek(c.time_sec) }}
                            className={`font-mono text-[13px] font-medium rounded-md px-2 py-0.5 cursor-pointer ${FOCUS} ${selected ? 'bg-[#FFB020] text-[#1A1200]' : 'bg-[#FFB020]/15 text-[#FFB020]'}`}
                          >{formatTime(c.time_sec)}</button>
                        )}
                        {region && <span className="text-xs text-[#FFB020]" title="範囲指定あり"><ScanLine className="w-3.5 h-3.5" aria-label="範囲指定あり" /></span>}
                        {authorName(c.author_email) && <span className="text-[13px] text-[#B4B9C4]">{authorName(c.author_email)}</span>}
                        <span className="ml-auto text-xs text-[#8F95A3] group-hover:hidden group-focus-within:hidden">{formatDate(c.created_at)}</span>
                        <div className="ml-auto hidden group-hover:flex group-focus-within:flex items-center gap-0.5">
                          <button type="button" onClick={e => { e.stopPropagation(); setReplyingToId(replyingToId === c.id ? null : c.id); setReplyText('') }} className={actBtn} title="返信" aria-label="返信"><Reply className="w-3.5 h-3.5" aria-hidden /></button>
                          <button type="button" onClick={e => handleCopyComment(e, c)} className={actBtn} title="コピー" aria-label="コピー">
                            {copiedCommentId === c.id ? <Check className="w-3.5 h-3.5 text-[#5BE3A0]" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
                          </button>
                          <button type="button" onClick={e => handleEditStart(e, c)} className={actBtn} title="編集" aria-label="編集"><Pencil className="w-3.5 h-3.5" aria-hidden /></button>
                          <button type="button" onClick={e => handleDelete(e, c.id)} className={actBtn + ' hover:!text-[#FF9A9A]'} title="削除" aria-label="削除"><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
                        </div>
                      </div>

                      {editingId === c.id ? (
                        <div onClick={e => e.stopPropagation()} className="flex flex-col gap-2">
                          <textarea
                            autoFocus rows={2} value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); handleEditSubmit(c) }
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            aria-label="コメントを編集"
                            className={`w-full rounded-lg bg-[#0E0F13] border border-[#2A2E37] px-3 py-2 text-sm resize-none ${FOCUS}`}
                          />
                          <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setEditingId(null)} className={`text-[13px] text-[#B4B9C4] hover:text-white px-2 py-1 rounded ${FOCUS}`}>キャンセル</button>
                            <button type="button" onClick={() => handleEditSubmit(c)} disabled={!editContent.trim()} className={`text-[13px] px-3 py-1 rounded-md bg-[#6F4CFF] text-white font-bold disabled:opacity-40 ${FOCUS}`}>保存</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
                      )}

                      {selected && region && <div className="text-xs text-[#FFB020]">選択中：動画上に範囲を表示しています</div>}
                    </div>

                    {replies.map(r => {
                      const { text: rText } = parseComment(r.content)
                      return (
                        <div
                          key={r.id}
                          onClick={() => { if (editingId !== r.id) handleSeek(r.time_sec) }}
                          onDoubleClick={e => handleEditStart(e, r)}
                          className="group ml-5 mt-1.5 p-3 rounded-xl bg-[#1D2027]/70 border border-[#2A2E37]"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Reply className="w-3.5 h-3.5 text-[#8F95A3]" aria-hidden />
                            {authorName(r.author_email) && <span className="text-[13px] text-[#B4B9C4]">{authorName(r.author_email)}</span>}
                            <span className="ml-auto text-xs text-[#8F95A3] group-hover:hidden group-focus-within:hidden">{formatDate(r.created_at)}</span>
                            <div className="ml-auto hidden group-hover:flex group-focus-within:flex items-center gap-0.5">
                              <button type="button" onClick={e => handleCopyComment(e, r)} className={actBtn} title="コピー" aria-label="コピー">
                                {copiedCommentId === r.id ? <Check className="w-3.5 h-3.5 text-[#5BE3A0]" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
                              </button>
                              <button type="button" onClick={e => handleEditStart(e, r)} className={actBtn} title="編集" aria-label="編集"><Pencil className="w-3.5 h-3.5" aria-hidden /></button>
                              <button type="button" onClick={e => handleDelete(e, r.id)} className={actBtn + ' hover:!text-[#FF9A9A]'} title="削除" aria-label="削除"><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
                            </div>
                          </div>
                          {editingId === r.id ? (
                            <div onClick={e => e.stopPropagation()} className="flex flex-col gap-2">
                              <textarea
                                autoFocus rows={2} value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                onCompositionStart={() => setIsComposing(true)}
                                onCompositionEnd={() => setIsComposing(false)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); handleEditSubmit(r) }
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                aria-label="返信を編集"
                                className={`w-full rounded-lg bg-[#0E0F13] border border-[#2A2E37] px-3 py-2 text-sm resize-none ${FOCUS}`}
                              />
                              <div className="flex gap-2 justify-end">
                                <button type="button" onClick={() => setEditingId(null)} className={`text-[13px] text-[#B4B9C4] hover:text-white px-2 py-1 rounded ${FOCUS}`}>キャンセル</button>
                                <button type="button" onClick={() => handleEditSubmit(r)} disabled={!editContent.trim()} className={`text-[13px] px-3 py-1 rounded-md bg-[#6F4CFF] text-white font-bold disabled:opacity-40 ${FOCUS}`}>保存</button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{rText}</p>
                          )}
                        </div>
                      )
                    })}

                    {replyingToId === c.id && (
                      <div className="ml-5 mt-1.5 flex flex-col gap-2 p-3 rounded-xl bg-[#1D2027]/50 border border-[#2A2E37]">
                        <textarea
                          autoFocus rows={2} value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onCompositionStart={() => setIsComposing(true)}
                          onCompositionEnd={() => setIsComposing(false)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); handleReplySubmit(c.id) }
                            if (e.key === 'Escape') setReplyingToId(null)
                          }}
                          placeholder="返信内容を入力..."
                          aria-label="返信内容"
                          className={`w-full rounded-lg bg-[#0E0F13] border border-[#2A2E37] px-3 py-2 text-sm placeholder:text-[#8F95A3] resize-none ${FOCUS}`}
                        />
                        <div className="flex gap-2 justify-end">
                          <button type="button" onClick={() => setReplyingToId(null)} className={`text-[13px] text-[#B4B9C4] hover:text-white px-2 py-1 rounded ${FOCUS}`}>キャンセル</button>
                          <button type="button" onClick={() => handleReplySubmit(c.id)} disabled={!replyText.trim()} className={`text-[13px] px-3 py-1 rounded-md bg-[#6F4CFF] text-white font-bold disabled:opacity-40 ${FOCUS}`}>返信</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
          )}
        </div>

        <div className="shrink-0 p-4 border-t border-[#2A2E37]">
          <button
            type="button" onClick={handleCopyAllComments} disabled={comments.length === 0}
            className={`w-full h-11 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[#262A33] disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`}
          >
            {copiedAll ? <Check className="w-4 h-4 text-[#5BE3A0]" aria-hidden /> : <ClipboardList className="w-4 h-4" aria-hidden />}
            {copiedAll ? 'コピーしました' : '修正指示をまとめてコピー'}
          </button>
        </div>
      </aside>
      </div>
    </div>
  )
}
