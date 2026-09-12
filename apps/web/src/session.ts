/**
 * Sesi auditor di sisi web (FR-02, FR-03).
 *
 * Token disimpan di cookie HttpOnly, bukan localStorage, agar tidak terbaca
 * skrip pihak ketiga. Access token berumur 15 menit, sehingga refresh token
 * rotatif dipakai diam-diam saat access token kedaluwarsa; pengguna tidak
 * pernah dilempar ke halaman login di tengah pekerjaan tanpa alasan.
 */
export const ACCESS_COOKIE = 'siapai_at'
export const REFRESH_COOKIE = 'siapai_rt'

export interface Sesi {
  access: string
  refresh: string
}

/** Membaca cookie dari header permintaan. */
export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const bagian of (header ?? '').split(';')) {
    const i = bagian.indexOf('=')
    if (i <= 0) continue
    out[bagian.slice(0, i).trim()] = decodeURIComponent(bagian.slice(i + 1).trim())
  }
  return out
}

export function sesiDari(cookieHeader: string | undefined): Sesi | null {
  const c = readCookies(cookieHeader)
  const access = c[ACCESS_COOKIE]
  const refresh = c[REFRESH_COOKIE]
  return access && refresh ? { access, refresh } : null
}

/**
 * Cookie sesi.
 * `secure` menyesuaikan protokol: memaksanya di demo lokal http akan membuat
 * cookie tidak pernah terkirim dan login seolah gagal tanpa sebab.
 */
export function cookieSesi(s: Sesi, opts: { secure: boolean }): string[] {
  const dasar = `Path=/; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`
  return [
    `${ACCESS_COOKIE}=${encodeURIComponent(s.access)}; ${dasar}; Max-Age=900`,
    `${REFRESH_COOKIE}=${encodeURIComponent(s.refresh)}; ${dasar}; Max-Age=2592000`,
  ]
}

export function cookieHapus(opts: { secure: boolean }): string[] {
  const dasar = `Path=/; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`
  return [
    `${ACCESS_COOKIE}=; ${dasar}; Max-Age=0`,
    `${REFRESH_COOKIE}=; ${dasar}; Max-Age=0`,
  ]
}

export const amanUntuk = (url: string) => url.startsWith('https://')
