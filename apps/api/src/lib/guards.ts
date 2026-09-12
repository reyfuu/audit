/**
 * Guard autentikasi (TRD §6, FR-03).
 *
 * Access token adalah JWT HS256 berumur 15 menit yang diterbitkan modul auth.
 *
 * Untuk demo dan uji, format `Bearer user:<id>` masih diterima, TETAPI hanya
 * bila `ALLOW_DEV_TOKENS` bernilai '1'. Di produksi jalur ini mati, sehingga
 * mengetahui id auditor saja tidak cukup untuk masuk.
 */
import { Elysia } from 'elysia'
import { verifyAccessToken } from './auth'
import { err } from './errors'

export interface AuthUser {
  id: string
  role?: string
}

/** Token pengembangan hanya aktif bila diizinkan secara eksplisit. */
export function devTokensAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.ALLOW_DEV_TOKENS === '1'
}

export function parseBearer(header: string | undefined, nowMs = Date.now()): AuthUser | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null

  const claims = verifyAccessToken(token, nowMs)
  if (claims) return { id: claims.sub, ...(claims.role ? { role: claims.role } : {}) }

  if (devTokensAllowed() && token.startsWith('user:')) {
    const id = token.slice(5).trim()
    return id ? { id } : null
  }
  return null
}

export const authGuard = new Elysia({ name: 'authGuard' })
  .derive({ as: 'scoped' }, ({ headers }) => ({ user: parseBearer(headers.authorization) }))
  .onBeforeHandle({ as: 'scoped' }, ({ user, status }) => {
    if (!user) return status(401, err('UNAUTHENTICATED', 'Token tidak valid atau tidak ada'))
  })

/**
 * Catatan model v2: tidak ada guard "org scope" berbasis header.
 * Auditor di-scope lewat `owner_auditor_id` di layer repository, dan responden
 * di-scope lewat token undangan. Keduanya menghindari header yang bisa dipalsu.
 */
