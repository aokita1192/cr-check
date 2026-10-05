'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Film, Link2, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import UserMenu from '@/components/UserMenu'

type Tab = 'upload' | 'url'

function detectUrlType(url: string): { label: string; icon: React.ReactNode } | null {
  if (!url) return null
  if (/youtube\.com|youtu\.be/.test(url)) return { label: 'YouTube', icon: <PlayCircle className="w-4 h-4 text-red-400" /> }
  if (/vimeo\.com/.test(url)) return { label: 'Vimeo', icon: <Film className="w-4 h-4 text-cyan-400" /> }
  if (/drive\.google\.com/.test(url)) return { label: 'Google Drive', icon: <Film className="w-4 h-4 text-yellow-400" /> }
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return { label: '動画ファイル', icon: <Film className="w-4 h-4 text-violet-400" /> }
  return { label: 'URL', icon: <Link2 className="w-4 h-4 text-zinc-400" /> }
}

export default function Home() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('upload')

  // アップロード用
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // URL入力用
  const [videoUrl, setVideoUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  // ---- アップロード処理 ----
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) setFile(selected)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type.startsWith('video/')) setFile(dropped)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('video', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました')
      router.push(`/project/${data.projectId}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'エラーが発生しました')
      setUploading(false)
    }
  }

  // ---- URL入力処理 ----
  const handleUrlSubmit = async () => {
    const trimmed = videoUrl.trim()
    if (!trimmed) return

    // Google Drive フォルダURLは未対応
    if (/drive\.google\.com\/(drive\/u?\/?\d*\/?folders|drive\/folders)/.test(trimmed)) {
      setUrlError('Google Drive のフォルダURLは未対応です。フォルダ内の各動画の共有リンクを個別に追加してください。')
      return
    }

    setUrlLoading(true)
    setUrlError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '作成に失敗しました')
      router.push(`/project/${data.projectId}`)
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'エラーが発生しました')
      setUrlLoading(false)
    }
  }

  const urlType = detectUrlType(videoUrl)

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <UserMenu />
      </div>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8">
          <Film className="w-8 h-8 text-violet-400" />
          <h1 className="text-2xl font-bold text-white">動画レビューツール</h1>
        </div>

        {/* タブ切り替え */}
        <div className="flex rounded-lg bg-zinc-900 p-1 mb-6 border border-zinc-800">
          <button
            onClick={() => setTab('upload')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'upload'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            ファイルをアップロード
          </button>
          <button
            onClick={() => setTab('url')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'url'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Link2 className="w-4 h-4" />
            URLで追加
          </button>
        </div>

        {/* アップロードタブ */}
        {tab === 'upload' && (
          <>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !file && inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                file
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <Upload className="w-10 h-10 mx-auto mb-3 text-zinc-500" />
              {file ? (
                <div>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-zinc-400 text-sm mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null) }}
                    className="text-zinc-500 text-xs mt-2 hover:text-zinc-300"
                  >
                    別のファイルを選ぶ
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-zinc-300">動画をドロップ、またはクリックして選択</p>
                  <p className="text-zinc-500 text-sm mt-1">MP4, MOV, WebM など</p>
                </div>
              )}
            </div>
            {uploadError && <p className="mt-3 text-red-400 text-sm">{uploadError}</p>}
            <Button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="mt-4 w-full bg-violet-600 hover:bg-violet-500 text-white"
            >
              {uploading ? 'アップロード中...' : 'アップロードして開始'}
            </Button>
          </>
        )}

        {/* URL入力タブ */}
        {tab === 'url' && (
          <>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <p className="text-sm text-zinc-400 mb-4">
                YouTube・Vimeo・MP4直リンクのURLを貼り付けてください。
              </p>

              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  {urlType ? urlType.icon : <Link2 className="w-4 h-4 text-zinc-600" />}
                </div>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                  placeholder="https://..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-3 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                />
              </div>

              {urlType && (
                <p className="mt-2 text-xs text-zinc-500">
                  検出: <span className="text-violet-400">{urlType.label}</span>
                </p>
              )}

              {/* 対応サービス */}
              <div className="mt-5 pt-4 border-t border-zinc-800">
                <p className="text-xs text-zinc-500 mb-3">対応サービス</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { name: 'YouTube', color: 'text-red-400 bg-red-400/10 border-red-400/20' },
                    { name: 'Vimeo', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
                    { name: 'MP4直リンク', color: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
                    { name: 'Google Drive*', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
                  ].map(({ name, color }) => (
                    <span key={name} className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-zinc-600">
                  * Google Drive: ファイル単体の共有リンクのみ対応。フォルダは未対応。seekが制限される場合あり。
                </p>
              </div>
            </div>

            {urlError && <p className="mt-3 text-red-400 text-sm">{urlError}</p>}
            <Button
              onClick={handleUrlSubmit}
              disabled={!videoUrl.trim() || urlLoading}
              className="mt-4 w-full bg-violet-600 hover:bg-violet-500 text-white"
            >
              {urlLoading ? '作成中...' : 'レビューを開始'}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
