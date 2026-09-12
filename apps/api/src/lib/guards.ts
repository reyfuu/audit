/**
 * Guard autentikasi dan scope organisasi (TRD §6, FRD §1).
 *
 * Token di sini disederhanakan: `Bearer user:<id>`. Di produksi diganti
 * verifikasi JWT, tetapi bentuk context yang disuntikkan tetap sama sehingga
 * modul di hilirnya tidak perlu berubah.
 */
import { Elysia } from 'elysia'
import { err } from './errors'

export interface AuthUser {
  id: string
}

export function parseBearer(header: string | undefined): AuthUser | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token.startsWith('user:')) return null
  const id = token.slice(5).trim()
  return id ? { id } : null
}

export const authGuard = new Elysia({ name: 'authGuard' })
  .derive({ as: 'scoped' }, ({ headers }) => ({ user: parseBearer(headers.authorization) }))
  .onBeforeHandle({ as: 'scoped' }, ({ user, status }) => {
    if (!user) return status(401, err('UNAUTHENTICATED', 'Token tidak valid atau tidak ada'))
  })

/**
 * Catatan model v2: tidak ada lagi guard "org scope" berbasis header.
 * Auditor di-scope lewat `owner_auditor_id` di layer repository, dan responden
 * di-scope lewat token undangan. Keduanya menghindari header yang bisa dipalsu.
 */
