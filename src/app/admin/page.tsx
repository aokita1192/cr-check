'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  BarChart3, Users, Zap, DollarSign, Clock, ArrowLeft,
  RefreshCw, Activity,
} from 'lucide-react'

type Stats = {
  total: { count: number; cost: number }
  byUser: Array<{ email: string; count: number; cost: number; lastAt: string }>
  byAction: Array<{ action: string; count: number; cost: number }>
  byDay: Array<{ day: string; count: number; cost: number }>
  recent: Array<{
    id: string; user_email: string; action: string;
    project_id: string | null; metadata: Record<string, unknown>;
    cost_usd: number; created_at: string
  }>
}

const ACTION_LABELS: Record<string, string> = {
  ai_detect: 'AI車種判定',
  project_create: 'プロジェクト作成',
  upload: '動画アップロード',
  video_view: '動画視聴',
}

function fmt(cost: number) {
  return cost < 0.01 ? `¥${(cost * 150).toFixed(1)}` : `$${cost.toFixed(4)}`
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/stats')
      if (!res.ok) throw new Error((await res.json()).error)
      setStats(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データ取得失敗')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-red-400">{error}</p>
      </main>
    )
  }

  const s = stats!

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* ヘッダー */}
      <div className="border-b border-zinc-800 bg-zinc-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <BarChart3 className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-bold">管理者ダッシュボード</h1>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          更新
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {/* サマリーカード */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Activity, label: '総利用回数', value: s.total.count.toLocaleString(), color: 'text-violet-400' },
            { icon: DollarSign, label: '総コスト', value: `$${s.total.cost.toFixed(4)}`, color: 'text-green-400', sub: `約¥${(s.total.cost * 150).toFixed(0)}` },
            { icon: Users, label: 'ユーザー数', value: s.byUser.length, color: 'text-blue-400' },
            { icon: Zap, label: 'AI判定回数', value: s.byAction.find(a => a.action === 'ai_detect')?.count ?? 0, color: 'text-yellow-400' },
          ].map(({ icon: Icon, label, value, color, sub }) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-xs text-zinc-500">{label}</span>
              </div>
              <p className="text-2xl font-bold">{value}</p>
              {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* ユーザー別利用状況 */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              ユーザー別利用状況
            </h2>
            <div className="space-y-3">
              {s.byUser.map(u => (
                <div key={u.email} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{u.email}</p>
                    <p className="text-xs text-zinc-500">
                      最終利用: {new Date(u.lastAt).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{u.count}回</p>
                    <p className="text-xs text-zinc-500">{fmt(u.cost)}</p>
                  </div>
                </div>
              ))}
              {s.byUser.length === 0 && (
                <p className="text-zinc-600 text-sm">データなし</p>
              )}
            </div>
          </div>

          {/* アクション別 */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              機能別利用状況
            </h2>
            <div className="space-y-3">
              {s.byAction.map(a => (
                <div key={a.action} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm text-white">{ACTION_LABELS[a.action] ?? a.action}</p>
                    <div className="mt-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full"
                        style={{ width: `${Math.min(100, (a.count / (s.total.count || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{a.count}回</p>
                    <p className="text-xs text-zinc-500">{fmt(a.cost)}</p>
                  </div>
                </div>
              ))}
              {s.byAction.length === 0 && (
                <p className="text-zinc-600 text-sm">データなし</p>
              )}
            </div>
          </div>
        </div>

        {/* 日別推移（直近14日） */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-violet-400" />
            日別利用推移（直近14日）
          </h2>
          <div className="flex items-end gap-1 h-24">
            {(() => {
              const recent14 = s.byDay.slice(-14)
              const max = Math.max(...recent14.map(d => d.count), 1)
              return recent14.map(d => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div
                    className="w-full bg-violet-600/70 rounded-sm"
                    style={{ height: `${(d.count / max) * 80}px` }}
                    title={`${d.day}: ${d.count}回 / ${fmt(d.cost)}`}
                  />
                  <p className="text-zinc-600 text-[10px] truncate w-full text-center">
                    {d.day.slice(5)}
                  </p>
                </div>
              ))
            })()}
            {s.byDay.length === 0 && (
              <p className="text-zinc-600 text-sm">データなし</p>
            )}
          </div>
        </div>

        {/* 直近アクティビティ */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            直近のアクティビティ
          </h2>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {s.recent.map(log => (
              <div key={log.id} className="flex items-center gap-3 py-1.5 border-b border-zinc-800 last:border-0">
                <span className="text-xs text-zinc-500 shrink-0 w-32">
                  {new Date(log.created_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-xs text-violet-300 shrink-0">{log.user_email.split('@')[0]}</span>
                <span className="text-xs text-zinc-400 flex-1">
                  {ACTION_LABELS[log.action] ?? log.action}
                </span>
                {log.cost_usd > 0 && (
                  <span className="text-xs text-zinc-600 shrink-0">{fmt(log.cost_usd)}</span>
                )}
              </div>
            ))}
            {s.recent.length === 0 && (
              <p className="text-zinc-600 text-sm">データなし</p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
