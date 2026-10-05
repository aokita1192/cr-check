import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/lib/auth-token'

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? 'aokita@mota.inc')
  .split(',').map(e => e.trim().toLowerCase())

const IS_PROD = process.env.NODE_ENV === 'production'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30日

export async function POST(request: NextRequest) {
  const { email } = await request.json()
  const normalized = (email ?? '').trim().toLowerCase()

  if (!normalized || !ALLOWED_EMAILS.includes(normalized)) {
    return NextResponse.json(
      { error: 'このメールアドレスは許可されていません' },
      { status: 403 }
    )
  }

  const token = await signToken(normalized)
  const res = NextResponse.json({ ok: true })

  res.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  res.cookies.set('user_email', normalized, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  return res
}
