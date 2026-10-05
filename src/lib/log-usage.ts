import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!key.startsWith('eyJ')) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key)
}

export async function logUsage(params: {
  user_email: string
  action: string
  project_id?: string | null
  metadata?: Record<string, unknown>
  cost_usd?: number
}) {
  try {
    const supabase = getAdminClient()
    if (!supabase) return
    await supabase.from('usage_logs').insert({
      user_email: params.user_email,
      action: params.action,
      project_id: params.project_id ?? null,
      metadata: params.metadata ?? {},
      cost_usd: params.cost_usd ?? 0,
    })
  } catch {
    // ログ失敗は無視して継続
  }
}
