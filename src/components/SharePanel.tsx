'use client'

import dynamic from 'next/dynamic'
import { useRef, useState, useCallback } from 'react'
import { Film, MessageSquare, Clock } from 'lucide-react'
import type { Comment } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactPlayer = dynamic(() => import('react-player'), { ssr: false }) as any

type Props = { videoUrl: string; comments: Comment[] }
type Region = { x1: number; y1: number; x2: number; y2: number }

function parseComment(content: string): { text: string; region: Region | null } {
  let rest = content
  const cm = rest.match(/^\[C:\w+\]/)
  if (cm) rest = rest.slice(cm[0].length)
  let region: Region | null = null
  const rm = rest.match(/^\[R:([\d.,]+)\]/)
  if (rm) {
    const parts = rm[1].split(',').map(Number)
    region = { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] }
    rest = rest.slice(rm[0].length)
  }
  return { text: rest, region }
}

function isNativeUrl(url: string) {
  return url.startsWith('/api/video/') || url.startsWith('/api/video-drive/')
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SharePanel({ videoUrl, comments }: Props) {
  const native = isNativeUrl(videoUrl)
  const nativeVideoRef = useRef<HTMLVideoElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactPlayerRef = useRef<any>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const hoveredRegion = hoveredId
    ? parseComment(comments.find(c => c.id === hoveredId)?.content ?? '').region
    : null

  const handleSeek = useCallback((sec: number) => {
    if (native && nativeVideoRef.current) nativeVideoRef.current.currentTime = sec
    else reactPlayerRef.current?.seekTo(sec, 'seconds')
  }, [native])

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      {/* 動画エリア */}
      <div className="flex-1 flex flex-col bg-black min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">動画レビュー（共有）</span>
          </div>
          <span className="text-xs text-zinc-500">閲覧専用</span>
        </div>

        {/* プレイヤー */}
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden relative">
          {native ? (
            <>
              <video
                ref={nativeVideoRef}
                src={videoUrl}
                controls
                className="w-full h-full"
                style={{ maxHeight: '100%' }}
              />
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
                  }}
                />
              )}
            </>
          ) : (
            <div className="w-full h-full">
              <ReactPlayer
                url={videoUrl}
                width="100%"
                height="100%"
                controls
                onReady={(p: unknown) => { reactPlayerRef.current = p }}
              />
            </div>
          )}
        </div>
      </div>

      {/* コメント一覧（読み取り専用） */}
      <div className="w-full lg:w-80 flex flex-col border-l border-zinc-800 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <MessageSquare className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">修正コメント ({comments.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {comments.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center mt-8">コメントはまだありません</p>
          ) : (
            comments.map(c => {
              const { text, region } = parseComment(c.content)
              return (
                <div
                  key={c.id}
                  onClick={() => handleSeek(c.time_sec)}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="w-full text-left pl-3 pr-3 py-3 rounded-lg border-l-4 border-l-red-500 cursor-pointer bg-zinc-800 hover:bg-zinc-700/80 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0 bg-red-500" />
                    <Clock className="w-3 h-3 text-violet-400" />
                    <span className="text-xs font-mono text-violet-400">{formatTime(c.time_sec)}</span>
                    {region && <span className="text-xs text-zinc-600" title="範囲指定あり">▣</span>}
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed">{text}</p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
