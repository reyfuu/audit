/**
 * Uji halaman masuk dan sesi auditor di web (FR-02, FR-03).
 *
 * Menelusuri HTML dan cookie seperti peramban: yang diuji adalah apa yang
 * benar-benar dialami pengguna, bukan fungsi internal.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../../api/src/app'
import { hashPassword } from '../../api/src/lib/auth'
import { createWebApp } from '../src/app'
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookies, cookieSesi } from '../src/session'

const BASE = 'http://localhost:3000'
const SANDI = 'sandiAuditor123'

async function setup(publicBase = BASE) {
  const { app: apiApp, repo } = createApp({ baseUrl: BASE })
  const auditor = await repo.createAuditor({
    email: 'd@x.id', name: 'Dimas', role: 'auditor', password_hash: hashPassword(SANDI),
  })
  const raw = (path: string, init: RequestInit = {}, token?: string) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }))
  const app = createWebApp({ raw, publicBase })

  const get = (p: string, cookie = '') =>
    app.handle(new Request(`${BASE}${p}`, { headers: cookie ? { cookie } : {} }))
  const post = (p: string, form: Record<string, string>, cookie = '') =>
    app.handle(new Request(`${BASE}${p}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      body: new URLSearchParams(form).toString(),
    }))

  /** Cookie gabungan dari respons, siap dipakai permintaan berikutnya. */
  const cookieDari = (res: Response) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0]!)
      .filter((c) => !c.endsWith('='))
      .join('; ')

  return { app, repo, auditor, raw, get, post, cookieDari }
}

describe('FR-02 halaman masuk', () => {
  it('akar situs menyajikan halaman masuk, bukan mengalihkan', async () => {
    const t = await setup()
    const res = await t.get('/')
    expect(res.status).toBe(200)
    const page = await res.text()
    expect(page).toContain('Masuk sebagai auditor')
    expect(page).toContain('type="password"')
  })

  it('masuk dapat dikirim langsung ke akar', async () => {
    const t = await setup()
    const res = await t.post('/', { email: 'd@x.id', password: SANDI })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/app')
  })

  it('alamat lama /masuk tetap dilayani agar tautan beredar tidak mati', async () => {
    const t = await setup()
    const res = await t.get('/masuk')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')

    // Termasuk kiriman formulir dari halaman yang sudah terbuka sebelum pindah.
    const kirim = await t.post('/masuk', { email: 'd@x.id', password: SANDI })
    expect(kirim.status).toBe(303)
    expect(kirim.headers.get('location')).toBe('/app')
  })

  it('pengunjung tanpa sesi diarahkan ke akar', async () => {
    const t = await setup()
    const res = await t.get('/app')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('halaman masuk hanya meminta email dan kata sandi', async () => {
    const t = await setup()
    const page = await (await t.get('/')).text()
    expect(page).toContain('name="email"')
    expect(page).toContain('type="password"')
    // Tidak ada login pihak ketiga, sesuai keputusan produk.
    expect(page.toLowerCase()).not.toContain('google')
  })

  it('kredensial benar membawa masuk dan menyetel cookie sesi', async () => {
    const t = await setup()
    const res = await t.post('/', { email: 'd@x.id', password: SANDI })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/app')
    const set = res.headers.getSetCookie?.() ?? []
    expect(set.some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(true)
    expect(set.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(true)
    // Token tidak boleh terbaca JavaScript pihak ketiga.
    expect(set.every((c) => c.includes('HttpOnly'))).toBe(true)
    expect(set.every((c) => c.includes('SameSite=Lax'))).toBe(true)
  })

  it('kata sandi salah menampilkan pesan tanpa membuka sesi', async () => {
    const t = await setup()
    const res = await t.post('/', { email: 'd@x.id', password: 'salah-sekali' })
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('Email atau kata sandi salah')
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0)
  })

  it('email tidak dikenal memberi pesan yang sama dengan kata sandi salah', async () => {
    const t = await setup()
    const a = await (await t.post('/', { email: 'd@x.id', password: 'salah' })).text()
    const b = await (await t.post('/', { email: 'hantu@x.id', password: 'salah' })).text()
    expect(a.replace(/d@x\.id/g, '')).toBe(b.replace(/hantu@x\.id/g, ''))
  })

  it('sesi aktif dapat membuka dashboard', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    const res = await t.get('/app', cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Ringkasan')
  })

  it('yang sudah masuk tidak dipaksa melihat halaman masuk lagi', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    const res = await t.get('/', cookie)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/app')
  })

  it('cookie basi tidak menyebabkan lingkaran pengalihan tanpa akhir', async () => {
    const t = await setup()
    // Meniru peramban yang menyimpan cookie dari proses demo sebelumnya:
    // cookienya ada, tetapi sesinya sudah mati bersama penyimpanan di memori.
    const basi = `${ACCESS_COOKIE}=basi.token.lama; ${REFRESH_COOKIE}=refresh-sudah-mati`

    // Dulu: /masuk -> /app -> /masuk -> ... sampai ERR_TOO_MANY_REDIRECTS.
    const masuk = await t.get('/', basi)
    expect(masuk.status).toBe(200)
    expect(await masuk.text()).toContain('type="password"')

    // Cookie basi ikut dibuang agar keadaan ini tidak berulang.
    const dibuang = masuk.headers.getSetCookie?.() ?? []
    expect(dibuang).toHaveLength(2)
    expect(dibuang.every((c) => c.includes('Max-Age=0'))).toBe(true)

    // Dari sisi /app cukup satu pengalihan, lalu berhenti.
    const app = await t.get('/app', basi)
    expect(app.status).toBe(303)
    expect(app.headers.get('location')).toBe('/')
    expect((await t.get('/', basi)).status).toBe(200)
  })

  it('cookie separuh atau kosong tidak membuat pengalihan berputar', async () => {
    const t = await setup()
    // Cookie akses dan refresh bisa hilang tidak bersamaan, mis. karena umurnya
    // berbeda. Tiap kombinasi harus berakhir di halaman masuk, bukan berputar.
    for (const cookie of [
      `${ACCESS_COOKIE}=hanya-access`,
      `${REFRESH_COOKIE}=hanya-refresh`,
      `${ACCESS_COOKIE}=; ${REFRESH_COOKIE}=`,
    ]) {
      const app = await t.get('/app', cookie)
      expect(app.headers.get('location')).toBe('/')
      expect((await t.get('/', cookie)).status).toBe(200)
    }
  })

  it('sesi yang sah tetap dilewatkan ke dashboard tanpa login ulang', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    const res = await t.get('/', cookie)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/app')
  })

  it('cookie ditandai Secure hanya bila situs dilayani lewat https', async () => {
    const lokal = await setup('http://localhost:3000')
    const aman = await setup('https://siapai.id')
    const c1 = (await lokal.post('/', { email: 'd@x.id', password: SANDI }))
      .headers.getSetCookie!()
    const c2 = (await aman.post('/', { email: 'd@x.id', password: SANDI }))
      .headers.getSetCookie!()
    expect(c1.every((c) => !c.includes('Secure'))).toBe(true)
    expect(c2.every((c) => c.includes('Secure'))).toBe(true)
  })
})

describe('FR-03 keluar', () => {
  it('menghapus cookie dan mencabut sesi di server', async () => {
    const t = await setup()
    const masuk = await t.post('/', { email: 'd@x.id', password: SANDI })
    const cookie = t.cookieDari(masuk)
    const refresh = readCookies(cookie)[REFRESH_COOKIE]!

    const keluar = await t.post('/keluar', {}, cookie)
    expect(keluar.headers.get('location')).toBe('/')
    expect((keluar.headers.getSetCookie?.() ?? []).every((c) => c.includes('Max-Age=0'))).toBe(true)

    // Refresh token lama benar-benar mati, bukan hanya hilang dari peramban.
    const coba = await t.raw('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    })
    expect(coba.status).toBe(401)
  })
})

describe('FR-03 access token kedaluwarsa', () => {
  it('sesi disegarkan diam-diam lewat refresh token, pengguna tidak terlempar keluar', async () => {
    const t = await setup()
    const masuk = await t.post('/', { email: 'd@x.id', password: SANDI })
    const sesi = readCookies(t.cookieDari(masuk))

    // Access token dirusak, seolah sudah kedaluwarsa; refresh masih sah.
    const rusak = cookieSesi(
      { access: 'token.tidak.sah', refresh: sesi[REFRESH_COOKIE]! }, { secure: false },
    ).map((c) => c.split(';')[0]!).join('; ')

    const res = await t.get('/app', rusak)
    expect(res.status).toBe(200)
    // Cookie baru dikirim balik, hasil rotasi.
    const set = res.headers.getSetCookie?.() ?? []
    expect(set.some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(true)
  })

  it('sesi yang sudah tidak sah mengarahkan kembali ke halaman masuk', async () => {
    const t = await setup()
    const palsu = cookieSesi({ access: 'a.b.c', refresh: 'refresh-palsu' }, { secure: false })
      .map((c) => c.split(';')[0]!).join('; ')
    const res = await t.get('/app', palsu)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })
})

describe('FR-29 navigasi sidebar', () => {
  it('setiap halaman dashboard memuat sidebar dengan tujuan yang sama', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    for (const path of ['/app', '/app/undangan', '/app/perusahaan', '/app/tinjauan', '/app/akun']) {
      const page = await (await t.get(path, cookie)).text()
      expect(page).toContain('class="side"')
      for (const label of ['Ringkasan', 'Undangan', 'Perusahaan', 'Tinjauan AI', 'Akun &amp; tim']) {
        expect(page).toContain(label)
      }
    }
  })

  it('menandai halaman yang sedang dibuka untuk pembaca layar', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    const page = await (await t.get('/app/perusahaan', cookie)).text()
    expect(page).toContain('href="/app/perusahaan" aria-current="page"')
    expect(page).not.toContain('href="/app" aria-current="page"')
  })

  it('sidebar menampilkan identitas yang sedang masuk dan tombol keluar', async () => {
    const t = await setup()
    const cookie = t.cookieDari(await t.post('/', { email: 'd@x.id', password: SANDI }))
    const page = await (await t.get('/app', cookie)).text()
    expect(page).toContain('d@x.id')
    expect(page).toContain('action="/keluar"')
  })
})
