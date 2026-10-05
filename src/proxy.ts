import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-token'

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? 'aokita@mota.inc')
  .split(',').map(e => e.trim().toLowerCase())
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'aokita@mota.inc')
  .split(',').map(e => e.trim().toLowerCase())

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 認証不要のパス
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/share/') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/video/') ||
    pathname.startsWith('/api/video-drive/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get('auth_token')?.value

  if (!token) {
    const url = new URL('/login', request.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  const payload = await verifyToken(token)

  if (!payload || !ALLOWED_EMAILS.includes(payload.email.toLowerCase())) {
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete('auth_token')
    res.cookies.delete('user_email')
    return res
  }

  // /admin は管理者のみ
  if (pathname.startsWith('/admin') && !ADMIN_EMAILS.includes(payload.email.toLowerCase())) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
