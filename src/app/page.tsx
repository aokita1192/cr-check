'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Film, Link2, PlayCircle, ArrowRight } from 'lucide-react'
import UserMenu from '@/components/UserMenu'

type VideoSubTab = 'upload' | 'url'

function detectUrlType(url: string): { label: string; icon: React.ReactNode } | null {
  if (!url) return null
  if (/youtube\.com|youtu\.be/.test(url)) return { label: 'YouTube', icon: <PlayCircle className="w-4 h-4 text-red-400" /> }
  if (/vimeo\.com/.test(url)) return { label: 'Vimeo', icon: <Film className="w-4 h-4 text-cyan-400" /> }
  if (/drive\.google\.com/.test(url)) return { label: 'Google Drive', icon: <Film className="w-4 h-4 text-yellow-400" /> }
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return { label: '動画ファイル', icon: <Film className="w-4 h-4 text-violet-400" /> }
  return { label: 'URL', icon: <Link2 className="w-4 h-4 text-[#B4B9C4]" /> }
}

export default function Home() {
  const router = useRouter()
  const [videoSubTab, setVideoSubTab] = useState<VideoSubTab>('url')

  // 動画アップロード
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  // 動画URL
  const [videoUrl, setVideoUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)


  // ---- 動画アップロード ----
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setVideoFile(f)
  }

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('video/')) setVideoFile(f)
  }

  const handleVideoUpload = async () => {
    if (!videoFile) return
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('video', videoFile)
    formData.append('media_type', 'video')
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

  // ---- 動画URL ----
  const handleUrlSubmit = async () => {
    const trimmed = videoUrl.trim()
    if (!trimmed) return
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
        body: JSON.stringify({ video_url: trimmed, media_type: 'video' }),
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

  const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A87FF]'
  const inputCls = `w-full h-[52px] rounded-xl border border-[#2A2E37] bg-[#16181D] text-[15px] text-[#ECEEF2] placeholder:text-[#8F95A3] ${focus}`

  const primaryBtn = ({ onClick, disabled, busy, label, busyLabel, hint }: {
    onClick: () => void; disabled: boolean; busy: boolean; label: string; busyLabel: string; hint: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-[52px] rounded-xl text-base font-bold flex items-center justify-center gap-2.5 transition-colors ${focus} ${
        disabled
          ? 'bg-[#1D2027] text-[#8F95A3] border border-[#2A2E37] cursor-not-allowed'
          : 'bg-[#6F4CFF] text-white hover:bg-[#7F60FF]'
      }`}
    >
      {busy ? busyLabel : disabled ? hint : <>{label}<ArrowRight className="w-[18px] h-[18px]" aria-hidden /></>}
    </button>
  )

  const errMsg = ({ msg }: { msg: string | null }) =>
    msg ? <p role="alert" className="text-sm text-[#FF9A9A]">{msg}</p> : null

  const dropZone = ({ file, setFile, inputRef, onDrop, accept, title, sub, icon, onChange }: {
    file: File | null; setFile: (f: File | null) => void; inputRef: React.RefObject<HTMLInputElement | null>
    onDrop: (e: React.DragEvent) => void; accept: string; title: string; sub: string
    icon: React.ReactNode; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  }) =>
    file ? (
      <div className="p-5 rounded-2xl border border-[#2A2E37] bg-[#16181D] flex items-center gap-4">
        <div className="shrink-0 w-14 h-14 rounded-xl bg-[#6F4CFF]/20 text-[#C3B6FF] flex items-center justify-center">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold truncate">{file.name}</div>
          <div className="text-[13px] text-[#B4B9C4]">{(file.size / 1048576).toFixed(1)} MB ・ 選択済み</div>
        </div>
        <button type="button" onClick={() => setFile(null)} className={`h-10 px-4 rounded-[10px] border border-[#2A2E37] bg-[#1D2027] text-sm font-medium hover:bg-[#262A33] ${focus}`}>変更</button>
      </div>
    ) : (
      <label
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="relative h-60 rounded-2xl border-2 border-dashed border-[#3A3F4B] bg-[#16181D] hover:border-[#8F7BFF] hover:bg-[#6F4CFF]/10 flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#9A87FF]"
      >
        <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="absolute w-px h-px opacity-0" />
        <Upload className="w-10 h-10 text-[#A794FF]" strokeWidth={1.6} aria-hidden />
        <span className="text-[17px] font-bold">{title}</span>
        <span className="text-sm text-[#B4B9C4]">{sub}</span>
      </label>
    )

  const subTab = (active: boolean) =>
    `h-11 px-1 -mb-px border-b-2 bg-transparent text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${focus} ${
      active ? 'border-[#6F4CFF] text-[#ECEEF2]' : 'border-transparent text-[#B4B9C4] hover:text-[#ECEEF2]'
    }`

  return (
    <div className="min-h-screen bg-[#0E0F13] text-[#ECEEF2] flex flex-col">
      <header className="h-14 shrink-0 px-5 flex items-center justify-between border-b border-[#2A2E37] bg-[#16181D]">
        <div className="flex items-center gap-2.5">
          <Film className="w-5 h-5 text-[#A794FF]" aria-hidden />
          <span className="text-[15px] font-bold">修正指示共有ツール</span>
        </div>
        <UserMenu />
      </header>

      <main className="flex-1 flex justify-center px-4">
        <div className="w-full max-w-[720px] pt-14 pb-16 flex flex-col gap-6">
          <div>
            <h1 className="text-[26px] font-bold leading-tight">レビューするファイルを追加</h1>
            <p className="mt-2 text-[#B4B9C4]">追加するとレビュー画面が開き、AI判定とコメントが使えます。</p>
          </div>

          <div className="flex gap-1 p-1 rounded-[14px] bg-[#16181D] border border-[#2A2E37]">
            <div className="flex-1 h-12 rounded-[10px] bg-[#6F4CFF] text-white flex items-center justify-center gap-2 text-[15px] font-bold">
              <Film className="w-[18px] h-[18px]" aria-hidden />動画
            </div>
            {['記事', 'バナー'].map(label => (
              <div key={label} aria-disabled="true" className="flex-1 h-12 flex items-center justify-center gap-2 text-[15px] text-[#8F95A3]">
                {label}
                <span className="h-[22px] px-2 rounded-full bg-[#1D2027] text-xs inline-flex items-center">準備中</span>
              </div>
            ))}
          </div>

          {(
            <>
              <div className="flex gap-6 border-b border-[#2A2E37]">
                <button type="button" onClick={() => setVideoSubTab('upload')} className={subTab(videoSubTab === 'upload')}>
                  <Upload className="w-4 h-4" aria-hidden />ファイルをアップロード
                </button>
                <button type="button" onClick={() => setVideoSubTab('url')} className={subTab(videoSubTab === 'url')}>
                  <Link2 className="w-4 h-4" aria-hidden />URLで追加
                </button>
              </div>

              {videoSubTab === 'upload' && (
                <>
                  {dropZone({
                    file: videoFile, setFile: setVideoFile, inputRef: videoInputRef,
                    onDrop: handleVideoDrop, onChange: handleVideoFileChange, accept: "video/*",
                    title: "動画をドロップ、またはクリックして選択", sub: "MP4 ・ MOV ・ WebM に対応",
                    icon: <Film className="w-[26px] h-[26px]" aria-hidden />,
                  })}
                  {errMsg({ msg: uploadError, })}
                  {primaryBtn({ onClick: handleVideoUpload, disabled: !videoFile || uploading, busy: uploading,
                    label: "アップロードして開始", busyLabel: "アップロード中...", hint: "ファイルを選ぶとアップロードできます", })}
                </>
              )}

              {videoSubTab === 'url' && (
                <>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="url" className="text-sm font-medium">動画のURL</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        {urlType ? urlType.icon : <Link2 className="w-4 h-4 text-[#8F95A3]" aria-hidden />}
                      </div>
                      <input
                        id="url" type="url" value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                        placeholder="https://"
                        className={`${inputCls} pl-11 pr-4`}
                      />
                    </div>
                    <span className="text-[13px] text-[#8F95A3]">
                      {urlType ? <>検出: <span className="text-[#A794FF]">{urlType.label}</span> ・ </> : null}
                      YouTube・Vimeo・MP4直リンク・Google Driveのファイル共有リンクに対応（フォルダは未対応）
                    </span>
                  </div>
                  {errMsg({ msg: urlError, })}
                  {primaryBtn({ onClick: handleUrlSubmit, disabled: !videoUrl.trim() || urlLoading, busy: urlLoading,
                    label: "レビューを開始", busyLabel: "作成中...", hint: "URLを入力すると追加できます", })}
                </>
              )}
            </>
          )}

        </div>
      </main>
    </div>
  )
}
