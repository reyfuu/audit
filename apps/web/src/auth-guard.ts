/**
 * Guard sesi auditor untuk sisi web.
 *
 * Semua halaman dashboard memanggil API dengan access token milik pengguna yang
 * sedang masuk. Bila access token kedaluwarsa (umurnya hanya 15 menit), refresh
 * token rotatif dipakai secara diam-diam. Bila itu pun gagal, pengguna diarahkan
 * ke halaman masuk, bukan disuguhi halaman kosong tanpa penjelasan.
 */
import { Elysia } from 'elysia'
import { amanUntuk, cookieHapus, cookieSesi, sesiDari, type Sesi } from './session'

/** Pemanggil API mentah; token diserahkan pemanggil, bukan disimpan di modul. */
export type RawApi = (path: string, init?: RequestInit, token?: string) => Promise<Response>

export interface AuthedApi {
  /** Memanggil API sebagai auditor yang sedang masuk. */
  (path: string, init?: RequestInit): Promise<Response>
}

export interface SessionContext {
  api: AuthedApi
  /** Cookie baru yang harus dikirim balik bila token dirotasi. */
  cookiesBaru: string[]
}

/** Menyegarkan sesi lewat refresh token rotatif; null bila sudah tidak sah. */
async function segarkan(raw: RawApi, sesi: Sesi): Promise<Sesi | null> {
  const res = await raw('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: sesi.refresh }),
  })
  if (!res.ok) return null
  const b = await res.json() as { access_token: string; refresh_token: string }
  return { access: b.access_token, refresh: b.refresh_token }
}

/**
 * Membangun pemanggil API untuk satu permintaan.
 * Mengembalikan null bila pengguna belum (atau tidak lagi) masuk.
 */
export async function sessionApi(
  raw: RawApi,
  cookieHeader: string | undefined,
  secure: boolean,
): Promise<SessionContext | null> {
  const sesi = sesiDari(cookieHeader)
  if (!sesi) return null

  let aktif = sesi
  let cookiesBaru: string[] = []

  // Sekali coba: bila access token ditolak, rotasi lalu ulangi satu kali.
  const cek = await raw('/auth/me', {}, aktif.access)
  if (cek.status === 401) {
    const baru = await segarkan(raw, aktif)
    if (!baru) return null
    aktif = baru
    cookiesBaru = cookieSesi(baru, { secure })
  }

  return {
    api: (path, init = {}) => raw(path, init, aktif.access),
    cookiesBaru,
  }
}

export interface AuthWebDeps {
  raw: RawApi
  /** Basis publik; menentukan apakah cookie ditandai Secure. */
  publicBase: string
}

/** Nilai `secure` untuk cookie, mengikuti protokol basis publik. */
export const secureDari = (publicBase: string) => amanUntuk(publicBase)

/**
 * Plugin yang menyediakan `sesi` pada konteks. Halaman yang memerlukan login
 * memanggil `sesi()` dan mengarahkan ke akar (halaman masuk) bila null.
 */
export function sessionPlugin({ raw, publicBase }: AuthWebDeps) {
  const secure = secureDari(publicBase)
  return new Elysia({ name: 'sesiAuditor' })
    .derive({ as: 'scoped' }, ({ headers }) => ({
      sesi: () => sessionApi(raw, headers.cookie, secure),
      hapusSesi: () => cookieHapus({ secure }),
    }))
}
