'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  MessageSquarePlus, Clock, Film, Copy, Check,
  AlertCircle, Loader2, Car, Trash2, Pencil, X, PenLine, Home,
  Reply, ClipboardList, Type,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Comment } from '@/lib/supabase'
import type { DetectResult } from '@/app/api/detect-car/route'
import type { EvidenceCheckResult } from '@/app/api/check-evidence/route'
import type { AnnotationCheckResult } from '@/app/api/check-annotation/route'
import UserMenu from '@/components/UserMenu'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactPlayer = dynamic(() => import('react-player'), { ssr: false }) as any

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactPlayerInstance = useRef<any>(null)
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
  const [panelWidth, setPanelWidth] = useState(320)
  const isDraggingH = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(320)

  // 縦パネルリサイズ（AI判定エリア高さ）
  const [aiPanelHeight, setAiPanelHeight] = useState(240)
  const isDraggingV = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(240)

  useLayoutEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingH.current) {
        const delta = dragStartX.current - e.clientX
        setPanelWidth(Math.max(220, Math.min(600, dragStartWidth.current + delta)))
      }
      if (isDraggingV.current) {
        const delta = dragStartY.current - e.clientY
        setAiPanelHeight(Math.max(120, Math.min(500, dragStartHeight.current + delta)))
      }
    }
    const onUp = () => {
      isDraggingH.current = false
      isDraggingV.current = false
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
    const video = nativeVideoRef.current
    const container = videoContainerRef.current
    if (!video || !container) return

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

    video.pause()

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

    setAnnotation({ popupX, popupY, rect: finalRect, time: video.currentTime, text: '' })
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
    const time = reactPlayerInstance.current?.getCurrentTime() ?? 0
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
    else reactPlayerInstance.current?.seekTo(sec, 'seconds')
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

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      {/* 動画プレイヤーエリア */}
      <div className="flex-1 flex flex-col bg-black min-w-0">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            {/* ホームボタン */}
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="ホームに戻る"
            >
              <Home className="w-4 h-4" />
            </Link>
            <span className="text-zinc-700 text-sm">|</span>
            <Film className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">動画レビュー</span>
            {/* アノテーションモード切替 */}
            {mode === 'native' && (
              <button
                onClick={() => { setAnnotateMode(v => !v); setAnnotation(null); setDragStart(null); setDragRect(null) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  annotateMode
                    ? 'bg-red-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                {annotateMode ? '範囲選択中' : '範囲を指摘'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCopyUrl} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'コピーしました' : 'URLをコピー'}
            </button>
            <UserMenu />
          </div>
        </div>

        {/* プレイヤー */}
        <div
          ref={mode === 'native' ? videoContainerRef : undefined}
          className="flex-1 flex items-center justify-center bg-black overflow-hidden relative"
        >
          {mode === 'native' && (
            <>
              <video ref={nativeVideoRef} src={videoUrl} controls className="w-full h-full" style={{ maxHeight: '100%' }} />

              {/* ホバーコメントの範囲ハイライト（常時表示、pointer-events-none） */}
              {hoveredRegion && (
                <div
                  className="absolute pointer-events-none z-10"
                  style={{
                    left: `${hoveredRegion.x1 * 100}%`,
                    top: `${hoveredRegion.y1 * 100}%`,
                    width: `${(hoveredRegion.x2 - hoveredRegion.x1) * 100}%`,
                    height: `${(hoveredRegion.y2 - hoveredRegion.y1) * 100}%`,
                    border: '2px solid #ef4444',
                    background: 'rgba(239,68,68,0.15)',
                    boxShadow: '0 0 0 1px rgba(239,68,68,0.4)',
                  }}
                />
              )}

              {/* アノテーションモード：ドラッグ入力オーバーレイ */}
              {annotateMode && (
                <div
                  className="absolute inset-x-0 top-0 z-20 select-none"
                  style={{
                    bottom: 56,
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
                        border: '2px solid #ef4444',
                        background: 'rgba(239,68,68,0.12)',
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
                    border: '2px solid #ef4444',
                    background: 'rgba(239,68,68,0.15)',
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
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 resize-none"
                    />
                    <button
                      onClick={handleAnnotationSubmit}
                      disabled={!annotation.text.trim()}
                      className="mt-2 w-full py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 hover:bg-red-500"
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
              <ReactPlayer
                url={videoUrl} width="100%" height="100%" controls
                onReady={(p: unknown) => { reactPlayerInstance.current = p }}
              />
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

        {/* 下部パネル */}
        <div className="border-t border-zinc-800 bg-zinc-900 shrink-0">
          {mode === 'react-player' && (
            <div className="p-4">
              <div className="flex gap-2 mb-3">
                <button
                  onClick={handleStampCurrentTime}
                  className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
                >
                  <Clock className="w-4 h-4 text-violet-400" />
                  現在時刻を記録
                </button>
                {stampedTime !== null && (
                  <span className="flex items-center px-3 py-2 bg-violet-900/40 border border-violet-700 rounded-lg text-sm text-violet-300 font-mono">
                    {formatTime(stampedTime)}
                  </span>
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
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 disabled:opacity-40"
                />
                <Button
                  onClick={handleSubmit}
                  disabled={!newComment.trim() || stampedTime === null || submitting}
                  size="sm" className="bg-red-600 hover:bg-red-500 text-white"
                >追加</Button>
              </div>
            </div>
          )}
          {(mode === 'drive-file' || mode === 'drive-folder') && (
            <div className="p-4">
              <p className="text-zinc-500 text-sm text-center">このプレイヤーではタイムスタンプ機能は使用できません</p>
            </div>
          )}

          {/* AI 車種判定 */}
          {canAIFeatures && (
            <div
              className="shrink-0 border-t border-zinc-700/50 flex flex-col overflow-hidden"
              style={{ height: aiPanelHeight }}
            >
              {/* 縦リサイズハンドル */}
              <div
                className="h-1.5 bg-zinc-700 hover:bg-violet-600 cursor-row-resize shrink-0 transition-colors"
                onMouseDown={e => {
                  e.preventDefault()
                  isDraggingV.current = true
                  dragStartY.current = e.clientY
                  dragStartHeight.current = aiPanelHeight
                  document.body.style.cursor = 'row-resize'
                }}
              />
            <div className="px-4 pb-4 pt-3 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-blue-400" />
                  <span className="font-medium text-zinc-400" style={{ fontSize: 14 }}>AI車種判定</span>
                </div>
                <Button
                  onClick={handleDetectCar}
                  disabled={detectingCar}
                  size="sm"
                  className="bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40"
                >
                  {detectingCar
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />判定中</>
                    : <><Car className="w-3.5 h-3.5 mr-1" />車種判定</>
                  }
                </Button>
              </div>

              {detectError && (
                <p className="text-red-400 text-sm">{detectError}</p>
              )}

              {!carDetectResult && !detectError && (
                <p className="text-zinc-600 text-sm">一時停止してボタンを押すと、フレーム内のテキストを読み取り車種を照合します</p>
              )}

              {carDetectResult && (() => {

                const results = carDetectResult.parsed
                if (!results) {
                  return (
                    <div className="mt-2 p-2.5 bg-zinc-800 rounded-lg border border-blue-800/30">
                      <p className="text-blue-400 font-mono text-xs mb-1">{formatTime(carDetectResult.time)}</p>
                      <p className="text-zinc-200 text-sm whitespace-pre-wrap">{carDetectResult.raw}</p>
                    </div>
                  )
                }
                return (
                  <div className="mt-2 space-y-2">
                    {results.map((p, idx) => {
                      const overallPass = p.vehicle_match && p.price_match !== false
                      const vehicleName = p.model
                        ? `${p.maker ?? ''} ${p.model}`.trim()
                        : (p.matched_vehicle ?? p.detected_text)
                      const isBidType = !!p.frame_diff_claim
                      const rows: Array<{ label: string; ok: boolean | null; value: string }> = isBidType ? [
                        // タイプB：入札差額フレーム
                        { label: '合否', ok: overallPass, value: overallPass ? '合格' : '不合格' },
                        { label: '車種', ok: p.vehicle_match, value: vehicleName },
                        { label: '年式', ok: null, value: p.year ? `${p.year}年式` : '—' },
                        { label: '走行距離', ok: null, value: p.mileage ?? '—' },
                        { label: '査定年月', ok: null, value: p.assessment_date ?? '—' },
                        {
                          label: '主張差額',
                          ok: p.vehicle_match ? p.price_match : null,
                          value: p.frame_diff_claim
                            ? `${p.frame_diff_claim}${p.calculated_diff ? ` → 実際 ${p.calculated_diff}` : ''}`
                            : '—',
                        },
                      ] : [
                        // タイプA：売却実績フレーム
                        { label: '合否', ok: overallPass, value: overallPass ? '合格' : '不合格' },
                        { label: '車種', ok: p.vehicle_match, value: vehicleName },
                        { label: '年式', ok: null, value: p.year ? `${p.year}年式` : '—' },
                        { label: '走行距離', ok: null, value: p.mileage ?? '—' },
                        {
                          label: '売却価格',
                          ok: p.vehicle_match && p.frame_price ? p.price_match : null,
                          value: p.frame_price
                            ? `${p.frame_price}${p.sheet_price_sell ? ` → 基準 ${p.sheet_price_sell}` : ''}`
                            : p.sheet_price_sell ? `基準 ${p.sheet_price_sell}` : '—',
                        },
                        {
                          label: '下取り額',
                          ok: p.vehicle_match && p.frame_trade ? p.price_match : null,
                          value: p.frame_trade
                            ? `${p.frame_trade}${p.sheet_price_trade ? ` → 基準 ${p.sheet_price_trade}` : ''}`
                            : p.sheet_price_trade ? `基準 ${p.sheet_price_trade}` : '—',
                        },
                      ]
                      return (
                        <div key={idx} className="rounded-lg overflow-hidden border border-zinc-700">
                          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
                            <Clock className="w-3 h-3 text-blue-400" />
                            <span className="text-blue-400 font-mono text-xs">{formatTime(carDetectResult.time)}</span>
                            {results.length > 1 && (
                              <span className="text-xs text-zinc-400 bg-zinc-700 px-1.5 py-0.5 rounded">{idx + 1}/{results.length}</span>
                            )}
                            <span className="text-xs text-zinc-500 ml-auto">{p.matched_row ?? ''}</span>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {rows.map(({ label, ok, value }) => (
                                <tr key={label} className="border-b border-zinc-800 last:border-0">
                                  <td className="px-3 py-2 text-zinc-500 text-xs whitespace-nowrap w-16">{label}</td>
                                  <td className="px-2 py-2 text-center w-8">
                                    {ok === true && <span className="text-green-400 font-bold text-base">○</span>}
                                    {ok === false && <span className="text-red-400 font-bold text-base">✗</span>}
                                    {ok === null && <span className="text-zinc-600 text-xs">—</span>}
                                  </td>
                                  <td className="px-2 py-2 text-zinc-200 text-xs">{value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {p.reason && (
                            <div className={`px-3 py-2 border-t border-zinc-700 ${overallPass ? 'bg-green-950/40' : 'bg-red-950/40'}`}>
                              <p className={`text-xs ${overallPass ? 'text-green-400' : 'text-red-400'}`}>{p.reason}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* エビデンス確認・注釈サイズ判定セクション */}
              {canAIFeatures && (<>
                <div className="mt-3 pt-3 border-t border-zinc-700/60">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <span className="font-medium text-zinc-400" style={{ fontSize: 14 }}>エビデンス確認</span>
                    </div>
                    <Button
                      onClick={handleCheckEvidence}
                      disabled={checkingEvidence}
                      size="sm"
                      className="bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40"
                    >
                      {checkingEvidence
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />確認中</>
                        : <><AlertCircle className="w-3.5 h-3.5 mr-1" />エビデンス確認</>
                      }
                    </Button>
                  </div>

                  {evidenceError && <p className="text-red-400 text-sm">{evidenceError}</p>}

                  {!evidenceResult && !evidenceError && (
                    <p className="text-zinc-600 text-sm">一時停止してボタンを押すと、フレームの訴求内容をエビデンスリストと照合します</p>
                  )}

                  {evidenceResult && (() => {
                    const evResults = evidenceResult.parsed
                    if (!evResults || evResults.length === 0) {
                      return <p className="text-zinc-500 text-sm mt-2">このフレームに訴求内容は検出されませんでした</p>
                    }
                    return (
                      <div className="mt-2 space-y-2">
                        <p className="text-amber-400/70 font-mono text-xs">{formatTime(evidenceResult.time)}</p>
                        {evResults.map((r, idx) => {
                          const isPass = r.status === '合格'
                          const isOut = r.status === '対象外'
                          const isJisseki = r.status === '査定実績で確認'
                          return (
                            <div key={idx} className="rounded-lg overflow-hidden border border-zinc-700">
                              <div className={`px-3 py-2 border-b border-zinc-700 flex items-center gap-2 ${
                                isPass ? 'bg-green-950/40' : isJisseki ? 'bg-blue-950/40' : isOut ? 'bg-zinc-800' : 'bg-red-950/40'
                              }`}>
                                <span className={`text-sm font-bold ${isPass ? 'text-green-400' : isJisseki ? 'text-blue-400' : isOut ? 'text-zinc-400' : 'text-red-400'}`}>
                                  {isPass ? '○' : isJisseki ? '↗' : isOut ? '—' : '✗'}
                                </span>
                                <span className="text-zinc-200 text-xs flex-1">{r.claim_in_frame}</span>
                                {r.evidence_no && (
                                  <span className="text-amber-400 text-xs font-mono bg-amber-400/10 px-1.5 py-0.5 rounded">{r.evidence_no}</span>
                                )}
                              </div>
                              <table className="w-full text-sm">
                                <tbody>
                                  {r.evidence_no && (
                                    <tr className="border-b border-zinc-800">
                                      <td className="px-3 py-1.5 text-zinc-500 text-xs whitespace-nowrap w-20">区分</td>
                                      <td className="px-2 py-1.5 text-zinc-300 text-xs">
                                        {r.evidence_category === 'A' ? 'A：根拠＋注釈が必要'
                                          : r.evidence_category === 'B' ? 'B：根拠のみ必要'
                                          : r.evidence_category === 'C' ? 'C：根拠・注釈不要'
                                          : r.evidence_category ?? '—'}
                                      </td>
                                    </tr>
                                  )}
                                  {r.expiry_date && (
                                    <tr>
                                      <td className="px-3 py-1.5 text-zinc-500 text-xs whitespace-nowrap">使用期限</td>
                                      <td className={`px-2 py-1.5 text-xs ${r.is_expired ? 'text-red-400' : 'text-zinc-300'}`}>
                                        {r.expiry_date}{r.is_expired ? '（期限切れ）' : '（有効）'}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              <div className={`px-3 py-1.5 border-t border-zinc-700 ${
                                isPass ? 'bg-green-950/30' : isJisseki ? 'bg-blue-950/30' : isOut ? 'bg-zinc-800/50' : 'bg-red-950/30'
                              }`}>
                                <p className={`text-xs ${isPass ? 'text-green-400' : isJisseki ? 'text-blue-400' : isOut ? 'text-zinc-500' : 'text-red-400'}`}>
                                  {r.reason}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-700/60">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Type className="w-4 h-4 text-violet-400" />
                      <span className="font-medium text-zinc-400" style={{ fontSize: 14 }}>注釈サイズ判定</span>
                    </div>
                    <Button
                      onClick={handleCheckAnnotation}
                      disabled={checkingAnnotation}
                      size="sm"
                      className="bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40"
                    >
                      {checkingAnnotation
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />判定中</>
                        : <><Type className="w-3.5 h-3.5 mr-1" />注釈確認</>
                      }
                    </Button>
                  </div>

                  {annotationError && <p className="text-red-400 text-sm">{annotationError}</p>}

                  {!annotationResult && !annotationError && (
                    <p className="text-zinc-600 text-sm">一時停止してボタンを押すと、フレーム内の注釈テキストサイズを判定します（基準：動画40px以上）</p>
                  )}

                  {annotationResult && (() => {
                    const ants = annotationResult.parsed
                    if (!ants || ants.length === 0) {
                      return <p className="text-zinc-500 text-sm mt-2">このフレームに注釈テキストは検出されませんでした</p>
                    }
                    return (
                      <div className="mt-2 space-y-2">
                        <p className="text-violet-400/70 font-mono text-xs">{formatTime(annotationResult.time)}</p>
                        {ants.map((a, idx) => {
                          const isPass = a.status === '合格'
                          const isUnknown = a.status === '検出不可'
                          return (
                            <div key={idx} className="rounded-lg overflow-hidden border border-zinc-700">
                              <div className={`px-3 py-2 border-b border-zinc-700 flex items-center gap-2 ${
                                isPass ? 'bg-green-950/40' : isUnknown ? 'bg-zinc-800' : 'bg-red-950/40'
                              }`}>
                                <span className={`text-base font-bold ${isPass ? 'text-green-400' : isUnknown ? 'text-zinc-400' : 'text-red-400'}`}>
                                  {isPass ? '○ 合格' : isUnknown ? '— 検出不可' : '✗ 不合格'}
                                </span>
                                <span className="text-xs text-zinc-500 ml-auto shrink-0">{a.video_format}</span>
                              </div>
                              {a.text_found && (
                                <div className="px-3 py-1.5 border-b border-zinc-800">
                                  <span className="text-zinc-500 text-xs">検出テキスト：</span>
                                  <span className="text-zinc-300 text-xs ml-1">{a.text_found}</span>
                                </div>
                              )}
                              {a.estimated_pt > 0 && (
                                <div className="px-3 py-2 border-b border-zinc-800">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-zinc-400 text-xs font-medium">推定フォントサイズ</span>
                                    <span className={`text-sm font-mono font-bold ${isPass ? 'text-green-400' : 'text-red-400'}`}>
                                      約 {a.estimated_pt}pt
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-zinc-500 text-xs">合格ライン</span>
                                    <span className="text-xs font-mono text-zinc-400">
                                      {a.min_pt ?? 40}pt以上（動画 40px以上）
                                    </span>
                                  </div>
                                  {!isPass && a.min_pt && (
                                    <div className="mt-1.5 px-2 py-1 bg-red-950/50 rounded text-xs text-red-300">
                                      → 編集ソフトで最低 <span className="font-bold text-red-200">{a.min_pt}pt</span> 以上に設定してください
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className={`px-3 py-1.5 ${isPass ? 'bg-green-950/30' : isUnknown ? 'bg-zinc-800/50' : 'bg-red-950/30'}`}>
                                <p className={`text-xs ${isPass ? 'text-green-400' : isUnknown ? 'text-zinc-500' : 'text-red-400'}`}>{a.reason}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </>)}
            </div>
            </div>
          )}
        </div>
      </div>

      {/* リサイズハンドル */}
      <div
        className="hidden lg:flex items-center justify-center w-1.5 bg-zinc-800 hover:bg-violet-600 cursor-col-resize shrink-0 transition-colors"
        onMouseDown={e => {
          e.preventDefault()
          isDraggingH.current = true
          dragStartX.current = e.clientX
          dragStartWidth.current = panelWidth
          document.body.style.cursor = 'col-resize'
        }}
      />

      {/* コメント一覧 */}
      <div className="w-full flex flex-col border-l border-zinc-800 bg-zinc-900 shrink-0" style={{ width: panelWidth }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <MessageSquarePlus className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">修正コメント ({comments.filter(c => !parseComment(c.content).replyTo).length})</span>
          <button
            onClick={handleCopyAllComments}
            disabled={comments.length === 0}
            className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30"
            title="全コメントをコピー"
          >
            {copiedAll ? <Check className="w-3.5 h-3.5 text-green-400" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {copiedAll ? 'コピー済み' : '全コピー'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {comments.filter(c => !parseComment(c.content).replyTo).length === 0 ? (
            <p className="text-zinc-500 text-sm text-center mt-8">コメントはまだありません</p>
          ) : (
            comments
              .filter(c => !parseComment(c.content).replyTo)
              .sort((a, b) => a.time_sec - b.time_sec)
              .map(c => {
                const { text, region } = parseComment(c.content)
                const replies = comments
                  .filter(r => parseComment(r.content).replyTo === c.id)
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                return (
                  <div key={c.id}>
                    {/* 親コメント */}
                    <div
                      onClick={() => { if (editingId !== c.id) handleSeek(c.time_sec) }}
                      onDoubleClick={e => handleEditStart(e, c)}
                      onMouseEnter={() => setHoveredCommentId(c.id)}
                      onMouseLeave={() => setHoveredCommentId(null)}
                      className={`relative w-full text-left pl-3 pr-3 py-3 rounded-lg border-l-4 border-l-red-500 transition-colors group cursor-pointer bg-zinc-800 hover:bg-zinc-700/80 ${editingId === c.id ? 'ring-1 ring-red-500' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-red-500" />
                          <span className="text-xs font-mono text-violet-400 group-hover:text-violet-300">
                            {formatTime(c.time_sec)}
                          </span>
                          {region && <span className="text-xs text-zinc-600" title="範囲指定あり">▣</span>}
                          {authorName(c.author_email) && (
                            <span className="text-xs text-zinc-500 bg-zinc-700 px-1.5 py-0.5 rounded">
                              {authorName(c.author_email)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); setReplyingToId(replyingToId === c.id ? null : c.id); setReplyText('') }}
                            className="p-1 rounded hover:bg-zinc-600" title="返信"
                          >
                            <Reply className="w-3 h-3 text-zinc-500" />
                          </button>
                          <button onClick={e => handleCopyComment(e, c)} className="p-1 rounded hover:bg-zinc-600" title="コピー">
                            {copiedCommentId === c.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
                          </button>
                          <button onClick={e => handleEditStart(e, c)} className="p-1 rounded hover:bg-zinc-600" title="編集">
                            <Pencil className="w-3 h-3 text-zinc-500" />
                          </button>
                          <button onClick={e => handleDelete(e, c.id)} className="p-1 rounded hover:bg-red-900" title="削除">
                            <Trash2 className="w-3 h-3 text-zinc-500" />
                          </button>
                        </div>
                      </div>
                      {editingId === c.id ? (
                        <div onClick={e => e.stopPropagation()} className="flex flex-col gap-1.5">
                          <textarea
                            autoFocus rows={2} value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); handleEditSubmit(c) }
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="w-full bg-zinc-700 border border-red-600 rounded px-2 py-1 text-sm text-white focus:outline-none resize-none"
                          />
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-0.5">キャンセル</button>
                            <button onClick={() => handleEditSubmit(c)} disabled={!editContent.trim()} className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white disabled:opacity-40">保存</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-200 leading-snug whitespace-pre-wrap">{text}</p>
                      )}
                    </div>

                    {/* 返信コメント */}
                    {replies.map(r => {
                      const { text: rText } = parseComment(r.content)
                      return (
                        <div
                          key={r.id}
                          onClick={() => { if (editingId !== r.id) handleSeek(r.time_sec) }}
                          onDoubleClick={e => handleEditStart(e, r)}
                          className={`ml-4 mt-1 relative w-full text-left pl-3 pr-3 py-2 rounded-lg border-l-4 border-l-zinc-600 transition-colors group cursor-pointer bg-zinc-800/70 hover:bg-zinc-700/60 ${editingId === r.id ? 'ring-1 ring-zinc-500' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <div className="flex items-center gap-1.5">
                              <Reply className="w-3 h-3 text-zinc-600" />
                              <span className="text-xs font-mono text-zinc-500">{formatTime(r.time_sec)}</span>
                              {authorName(r.author_email) && (
                                <span className="text-xs text-zinc-600 bg-zinc-700/60 px-1.5 py-0.5 rounded">
                                  {authorName(r.author_email)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={e => handleCopyComment(e, r)} className="p-1 rounded hover:bg-zinc-600" title="コピー">
                                {copiedCommentId === r.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
                              </button>
                              <button onClick={e => handleEditStart(e, r)} className="p-1 rounded hover:bg-zinc-600" title="編集">
                                <Pencil className="w-3 h-3 text-zinc-500" />
                              </button>
                              <button onClick={e => handleDelete(e, r.id)} className="p-1 rounded hover:bg-red-900" title="削除">
                                <Trash2 className="w-3 h-3 text-zinc-500" />
                              </button>
                            </div>
                          </div>
                          {editingId === r.id ? (
                            <div onClick={e => e.stopPropagation()} className="flex flex-col gap-1.5">
                              <textarea
                                autoFocus rows={2} value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                onCompositionStart={() => setIsComposing(true)}
                                onCompositionEnd={() => setIsComposing(false)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); handleEditSubmit(r) }
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                className="w-full bg-zinc-700 border border-zinc-500 rounded px-2 py-1 text-sm text-white focus:outline-none resize-none"
                              />
                              <div className="flex gap-1.5 justify-end">
                                <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-0.5">キャンセル</button>
                                <button onClick={() => handleEditSubmit(r)} disabled={!editContent.trim()} className="text-xs px-2 py-0.5 bg-zinc-600 hover:bg-zinc-500 rounded text-white disabled:opacity-40">保存</button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-zinc-300 leading-snug whitespace-pre-wrap">{rText}</p>
                          )}
                        </div>
                      )
                    })}

                    {/* 返信入力フォーム */}
                    {replyingToId === c.id && (
                      <div className="ml-4 mt-1 flex flex-col gap-1.5 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700">
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
                          className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 resize-none"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setReplyingToId(null)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-0.5">キャンセル</button>
                          <button
                            onClick={() => handleReplySubmit(c.id)}
                            disabled={!replyText.trim()}
                            className="text-xs px-2 py-0.5 bg-zinc-600 hover:bg-zinc-500 rounded text-white disabled:opacity-40"
                          >返信</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
          )}
        </div>
      </div>
    </div>
  )
}
