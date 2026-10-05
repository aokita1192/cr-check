import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!key.startsWith('eyJ')) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { user_email, action, project_id, metadata, cost_usd } = body

    if (!user_email || !action) {
      return NextResponse.json({ error: 'user_email and action required' }, { status: 400 })
    }

    const supabase = getAdminClient()
    if (!supabase) return NextResponse.json({ ok: true }) // キー未設定時はスキップ
    const { error } = await supabase.from('usage_logs').insert({
      user_email,
      action,
      project_id: project_id ?? null,
      metadata: metadata ?? {},
      cost_usd: cost_usd ?? 0,
    })

    if (error) {
      console.error('Usage log error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Usage route error:', err)
    return NextResponse.json({ ok: true }) // ログ失敗は無視して継続
  }
}
