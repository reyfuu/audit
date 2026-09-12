/**
 * Autentikasi auditor (FR-01, FR-03, FR-04).
 *
 * Keputusan keamanan:
 *  - Kode OTP dan refresh token disimpan sebagai hash, tidak pernah polos.
 *  - Refresh token rotatif: sekali pakai. Pemakaian ulang menandakan token
 *    dicuri, sehingga seluruh keluarga token dicabut sekaligus.
 *  - Percobaan OTP dibatasi, dan respons dibuat seragam agar tidak
 *    membocorkan email mana yang terdaftar.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const ACCESS_TTL_SEC = 15 * 60
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

function secret(): string {
  const s = process.env.AUTH_SECRET
  if (!s && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET wajib disetel di produksi')
  }
  return s ?? 'dev-only-secret-change-me'
}

/** Kode 6 digit dari CSPRNG; `randomInt` menghindari bias modulo. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(email: string, code: string): string {
  // Email ikut di-hash agar kode yang sama untuk email berbeda tidak bertabrakan.
  return createHash('sha256').update(`${secret()}:${email.toLowerCase()}:${code}`).digest('hex')
}

export function otpMatches(email: string, code: string, expected: string): boolean {
  const a = Buffer.from(hashOtp(email, code), 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(`${secret()}:refresh:${token}`).digest('hex')
}

// ── JWT minimal (HS256), cukup untuk access token berumur pendek.
export interface AccessClaims {
  sub: string
  role: string
  /** Detik sejak epoch. */
  exp: number
  iat: number
}

const b64u = (b: Buffer | string) =>
  Buffer.from(b).toString('base64url')

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function issueAccessToken(
  auditorId: string,
  role: string,
  nowMs = Date.now(),
): { token: string; expires_in: number } {
  const iat = Math.floor(nowMs / 1000)
  const exp = iat + ACCESS_TTL_SEC
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(JSON.stringify({ sub: auditorId, role, iat, exp } satisfies AccessClaims))
  const body = `${header}.${payload}`
  return { token: `${body}.${sign(body)}`, expires_in: ACCESS_TTL_SEC }
}

/**
 * Memverifikasi access token.
 * Mengembalikan null untuk token apa pun yang tidak sah, tanpa membedakan
 * penyebabnya, agar tidak menjadi orakel bagi penyerang.
 */
export function verifyAccessToken(token: string, nowMs = Date.now()): AccessClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts as [string, string, string]

  const expected = sign(`${header}.${payload}`)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }
    // Tolak alg lain, termasuk "none", agar tidak bisa diakali.
    if (h.alg !== 'HS256') return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AccessClaims
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null
    if (!claims.sub) return null
    return claims
  } catch {
    return null
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
