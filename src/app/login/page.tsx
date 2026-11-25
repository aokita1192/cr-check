'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Film, Mail, LogIn, AlertCircle, Loader2 } from 'lucide-react'

const DOMAIN_RE = /^[^\s@]+@mota\.inc$/i

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const trimmed = email.trim()
  const valid = DOMAIN_RE.test(trimmed)
  const domainError = trimmed.indexOf('@') > 0 && !valid

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || loading) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed.toLowerCase() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'ログインに失敗しました')
      } else {
        router.push(next)
        router.refresh()
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0E0F13] text-[#ECEEF2] flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] flex flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#6F4CFF] text-white flex items-center justify-center">
            <Film className="w-7 h-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-[26px] font-bold leading-tight">修正指示共有ツール</h1>
            <p className="mt-2 text-sm text-[#B4B9C4]">クリエイティブチェック（社内向け）</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="p-7 rounded-2xl bg-[#16181D] border border-[#2A2E37] flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium">メールアドレス</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#8F95A3]" aria-hidden />
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@mota.inc"
                autoComplete="email"
                autoFocus
                disabled={loading}
                aria-invalid={domainError}
                aria-describedby="email-help"
                className="w-full h-12 pl-11 pr-3.5 rounded-[10px] border border-[#2A2E37] bg-[#0E0F13] text-[15px] text-[#ECEEF2] placeholder:text-[#8F95A3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A87FF] disabled:opacity-50"
              />
            </div>
            <p
              id="email-help"
              role={domainError ? 'alert' : undefined}
              className={`text-[13px] ${domainError ? 'text-[#FF9A9A]' : 'text-[#8F95A3]'}`}
            >
              {domainError
                ? '@mota.inc のメールアドレスを入力してください'
                : '会社のメールアドレス（@mota.inc）でログインできます'}
            </p>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-[10px] bg-red-900/30 border border-red-700/40">
              <AlertCircle className="w-4 h-4 text-[#FF9A9A] shrink-0 mt-0.5" aria-hidden />
              <p className="text-sm text-[#FFB4B4]">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!valid || loading}
            className="h-12 rounded-[10px] flex items-center justify-center gap-2.5 text-[15px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A87FF] bg-[#6F4CFF] text-white hover:bg-[#7F60FF] disabled:bg-[#1D2027] disabled:text-[#8F95A3] disabled:border disabled:border-[#2A2E37] disabled:cursor-not-allowed"
          >
            {loading
              ? <><Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />ログイン中...</>
              : <><LogIn className="w-[18px] h-[18px]" aria-hidden />ログイン</>}
          </button>
        </form>

        <p className="text-center text-[13px] text-[#8F95A3]">
          このツールは社内専用です。社外への共有はできません。
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
