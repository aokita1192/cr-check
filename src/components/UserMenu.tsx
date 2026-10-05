'use client'

import { useState, useEffect } from 'react'
import { LogOut, LayoutDashboard, User, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? 'aokita@mota.inc')
  .split(',').map(e => e.trim().toLowerCase())

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export default function UserMenu() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setEmail(getCookieValue('user_email'))
  }, [])

  if (!email) return null

  const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase())

  const handleLogout = async () => {
    setOpen(false)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors text-xs"
      >
        <User className="w-3.5 h-3.5" />
        <span className="max-w-[120px] truncate">{email.split('@')[0]}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-48 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-zinc-800">
              <p className="text-xs text-zinc-500">ログイン中</p>
              <p className="text-xs text-white truncate mt-0.5">{email}</p>
            </div>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-violet-400" />
                管理者ダッシュボード
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-300 hover:text-red-300 hover:bg-red-900/20 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  )
}
