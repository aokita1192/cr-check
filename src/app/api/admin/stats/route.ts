import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-token'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'aokita@mota.inc')
  .split(',').map(e => e.trim().toLowerCase())

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  // プレースホルダーや未設定の場合はエラーにする（JWTは必ず "eyJ" で始まる）
  if (!key.startsWith('eyJ')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY が未設定です。Supabase ダッシュボード → Project Settings → API → service_role のキーを .env.local に設定してください。')
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key)
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const payload = token ? await verifyToken(token) : null

  if (!payload || !ADMIN_EMAILS.includes(payload.email.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = getAdminClient()

  const { data: logs, error } = await admin
    .from('usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const safeLog = logs ?? []
  const byUser: Record<string, { count: number; cost: number; lastAt: string }> = {}
  const byAction: Record<string, { count: number; cost: number }> = {}
  const byDay: Record<string, { count: number; cost: number }> = {}
  let totalCost = 0

  for (const log of safeLog) {
    const cost = Number(log.cost_usd ?? 0)
    totalCost += cost

    if (!byUser[log.user_email]) byUser[log.user_email] = { count: 0, cost: 0, lastAt: log.created_at }
    byUser[log.user_email].count++
    byUser[log.user_email].cost += cost
    if (log.created_at > byUser[log.user_email].lastAt) byUser[log.user_email].lastAt = log.created_at

    if (!byAction[log.action]) byAction[log.action] = { count: 0, cost: 0 }
    byAction[log.action].count++
    byAction[log.action].cost += cost

    const day = log.created_at.slice(0, 10)
    if (!byDay[day]) byDay[day] = { count: 0, cost: 0 }
    byDay[day].count++
    byDay[day].cost += cost
  }

  return NextResponse.json({
    total: { count: safeLog.length, cost: totalCost },
    byUser: Object.entries(byUser).map(([email, v]) => ({ email, ...v })).sort((a, b) => b.count - a.count),
    byAction: Object.entries(byAction).map(([action, v]) => ({ action, ...v })).sort((a, b) => b.count - a.count),
    byDay: Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    recent: safeLog.slice(0, 100),
  })
}
