// 署名付きセッショントークン（Edge/Node 両対応の Web Crypto API）

function getSecret() {
  return process.env.APP_SECRET ?? 'change-me-in-production-32chars!!'
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

export async function signToken(email: string): Promise<string> {
  const payload = {
    email,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30日
  }
  const data = btoa(JSON.stringify(payload))
  const key = await getKey()
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${toBase64Url(sig)}`
}

export async function verifyToken(token: string): Promise<{ email: string } | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const data = token.slice(0, dot)
    const sigStr = token.slice(dot + 1)

    const key = await getKey()
    const sigBuf = fromBase64Url(sigStr)
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBuf.buffer as ArrayBuffer, new TextEncoder().encode(data)
    )
    if (!valid) return null

    const payload = JSON.parse(atob(data))
    if (!payload.exp || payload.exp < Date.now()) return null

    return { email: payload.email }
  } catch {
    return null
  }
}
