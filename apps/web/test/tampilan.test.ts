/**
 * Uji lapisan tampilan dashboard.
 *
 * Memeriksa hal yang mudah rusak diam-diam saat markup diubah: ikon benar-benar
 * ada, tidak ada emoji yang bentuknya berbeda antar sistem, status tidak hanya
 * dibedakan oleh warna, dan tabel membawa label kolom untuk mode kartu di HP.
 *
 * Yang berkaitan dengan ukuran terhitung dan tata letak sungguhan diperiksa
 * oleh `bun run check:visual` memakai browser, bukan di sini.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../../api/src/app'
import { hashPassword } from '../../api/src/lib/auth'
import { createWebApp } from '../src/app'
import { ICONS, type IconName } from '../src/icons'
import { NAV } from '../src/shell'

const BASE = 'http://localhost:3000'
const SANDI = 'sandiAuditor123'

async function setup() {
  const { app: apiApp, repo } = createApp({ baseUrl: BASE })
  const auditor = await repo.createAuditor({
    email: 'd@x.id', name: 'Dimas', role: 'auditor_admin', password_hash: hashPassword(SANDI),
  })
  const raw = (path: string, init: RequestInit = {}, token?: string) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }))
  const app = createWebApp({ raw, publicBase: BASE })

  let cookie = ''
  const simpan = (res: Response) => {
    const set = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!)
      .filter((c) => !c.endsWith('='))
    if (set.length) cookie = set.join('; ')
    return res
  }
  const get = (p: string) =>
    app.handle(new Request(`${BASE}${p}`, { headers: cookie ? { cookie } : {} })).then(simpan)
  const post = (p: string, form: Record<string, string> = {}) =>
    app.handle(new Request(`${BASE}${p}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      body: new URLSearchParams(form).toString(),
    })).then(simpan)

  await post('/', { email: 'd@x.id', password: SANDI })
  return { app, repo, auditor, get, post }
}

/** Emoji berwarna: bentuknya berbeda antar sistem dan bertabrakan dengan ikon garis. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

const HALAMAN = ['/app', '/app/undangan', '/app/perusahaan', '/app/tinjauan', '/app/akun']

describe('ikon navigasi', () => {
  it('setiap item sidebar memakai ikon SVG, bukan emoji', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    // Lima item nav plus tombol keluar.
    expect((page.match(/<svg class="icon"/g) ?? []).length).toBeGreaterThanOrEqual(6)
    const sidebar = /<nav class="side"[\s\S]*?<\/nav>/.exec(page)![0]
    expect(sidebar).not.toMatch(EMOJI)
  })

  it('ikon mewarisi warna teks sehingga mengikuti keadaan aktif', () => {
    for (const nama of Object.keys(ICONS) as IconName[]) {
      expect(ICONS[nama]).toContain('currentColor')
      // Ukuran ditentukan eksplisit agar tidak melonjak sebelum CSS termuat.
      expect(ICONS[nama]).toMatch(/width="\d+" height="\d+"/)
      // Ikon bersifat dekoratif; labelnya sudah ada sebagai teks di sebelahnya.
      expect(ICONS[nama]).toContain('aria-hidden="true"')
    }
  })

  it('setiap tujuan navigasi punya ikon yang berbeda', () => {
    const dipakai = NAV.map((n) => ICONS[n.icon])
    expect(new Set(dipakai).size).toBe(NAV.length)
  })

  it('tidak ada emoji tersisa di seluruh halaman dashboard', async () => {
    const t = await setup()
    for (const p of HALAMAN) {
      const page = await (await t.get(p)).text()
      const badan = /<main class="main">[\s\S]*?<\/main>/.exec(page)?.[0] ?? page
      expect(badan).not.toMatch(EMOJI)
    }
  })
})

describe('status terbaca tanpa bergantung warna', () => {
  it('lencana status membawa titik penanda selain warna teks', async () => {
    const t = await setup()
    await t.post('/app/perusahaan', {
      name: 'PT Warna', industry: 'fnb', employee_band: '10_49',
    })
    const daftar = await (await t.get('/app/perusahaan')).text()
    expect(daftar).toContain('PT Warna')

    // Terbitkan undangan supaya ada lencana status di daftar.
    const id = /<select class="field" name="company_id"[^>]*>\s*<option value="([^"]+)"/
      .exec(await (await t.get('/app/undangan')).text())![1]!
    expect((await t.post('/app/undangan', { company_id: id })).status).toBe(303)

    const page = await (await t.get('/app/undangan')).text()
    expect(page).toContain('class="pill"')
    expect(page).toContain('class="dot"')
  })
})

describe('tabel dapat dibaca di layar sempit', () => {
  it('sel membawa label kolom untuk mode kartu', async () => {
    const t = await setup()
    await t.post('/app/perusahaan', {
      name: 'PT Kartu', industry: 'fnb', employee_band: '10_49',
    })
    const perusahaan = await (await t.get('/app/perusahaan')).text()
    expect(perusahaan).toContain('data-l="Industri"')
    expect(perusahaan).toContain('data-l="Undangan"')

    // Terbitkan undangan lewat id perusahaan yang benar-benar milik auditor ini.
    const { items } = await (await t.app.handle(new Request(
      'http://localhost:3001/companies',
    ))).json().catch(() => ({ items: [] })) as { items: { id: string }[] }
    const id = items[0]?.id
      ?? /<select class="field" name="company_id"[^>]*>\s*<option value="([^"]+)"/
        .exec(await (await t.get('/app/undangan')).text())?.[1]
    expect(id).toBeTruthy()
    const terbit = await t.post('/app/undangan', { company_id: id! })
    expect(terbit.status).toBe(303)

    const undangan = await (await t.get('/app/undangan')).text()
    expect(undangan).toContain('data-l="Status"')
    expect(undangan).toContain('data-l="Progres"')
  })

  it('gaya kartu hanya aktif pada layar sempit, bukan di laptop', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    // Aturan kartu harus berada di dalam media query, bukan berlaku global.
    const i = page.indexOf('.tbl td[data-l]::before')
    expect(i).toBeGreaterThan(-1)
    const sebelum = page.slice(0, i)
    expect(sebelum.lastIndexOf('@media (max-width:720px)'))
      .toBeGreaterThan(sebelum.lastIndexOf('}\n\n@media (max-width:860px)'))
  })
})

describe('pesan penting disertai ikon', () => {
  it('banner error memakai peran alert dan ikon peringatan', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/sandi', { new_password: 'pendek' })
    const page = await (await t.get(res.headers.get('location')!)).text()
    expect(page).toContain('role="alert"')
    expect(page).toContain('banner-error')
    expect(page).toMatch(/<div class="banner banner-error"[^>]*>\s*<svg/)
  })

  it('banner sukses memakai peran status, bukan alert yang menyela', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/undang', { email: 'baru@x.id', role: 'auditor' })
    const page = await (await t.get(res.headers.get('location')!)).text()
    expect(page).toContain('role="status"')
    expect(page).toContain('banner-ok')
  })
})

describe('tombol lihat kata sandi', () => {
  it('halaman masuk menyediakan kolom kata sandi yang dapat ditampilkan', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/`))).text()
    expect(page).toContain('class="password-wrap"')
    expect(page).toContain('password-toggle')
    expect(page).toContain('Tampilkan kata sandi')
  })

  it('halaman akun memasang tombol pada kedua kolom kata sandi', async () => {
    const t = await setup()
    const page = await (await t.get('/app/akun')).text()
    expect((page.match(/class="password-wrap"/g) ?? [])).toHaveLength(2)
    expect(page).toContain('id="cur"')
    expect(page).toContain('id="new"')
  })

  it('kolom tetap bertipe password pada HTML awal, bukan teks terbuka', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/`))).text()
    // Tanpa JavaScript, kata sandi tidak boleh terlihat sama sekali.
    expect(page).toMatch(/id="password"[^>]*type="password"/)
    expect(page).not.toMatch(/id="password"[^>]*type="text"/)
  })

  it('tombol ditambahkan lewat skrip, sehingga tanpa JS tidak ada tombol mati', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/`))).text()
    const badan = page.slice(0, page.indexOf('<script'))
    // Di markup awal belum ada elemen tombolnya; hanya skrip yang membuatnya.
    expect(badan).not.toContain('<button type="button" class="password-toggle"')
    expect(page).toContain('createElement')
  })

  it('status tombol diumumkan ke pembaca layar', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/`))).text()
    expect(page).toContain('aria-pressed')
    expect(page).toContain('Sembunyikan kata sandi')
  })

  it('kolom kode OTP tidak ikut diberi tombol, karena bukan kata sandi', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/masuk/kode`))).text()
    // Hanya badan halaman yang diperiksa; CSS global memang memuat gayanya.
    const badan = page.slice(page.indexOf('</style>'))
    expect(badan).not.toContain('password-wrap')

    // Layar kedua, tempat kode 6 digit diketik, juga tidak memakai tombol itu.
    const layarKode = await (await t.app.handle(new Request(`${BASE}/masuk/kode`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'd@x.id' }).toString(),
    }))).text()
    const badanKode = layarKode.slice(layarKode.indexOf('</style>'))
    expect(badanKode).toContain('one-time-code')
    expect(badanKode).not.toContain('password-wrap')
  })
})

describe('lencana merek', () => {
  it('sidebar memiliki logo yang menjadi tautan ke ringkasan', async () => {
    const t = await setup()
    const page = await (await t.get('/app/undangan')).text()
    expect(page).toMatch(/<a class="logo" href="\/app">/)
    expect(page).toContain('logo-mark')
  })

  it('halaman masuk memakai lencana yang sama agar terasa satu produk', async () => {
    const t = await setup()
    const page = await (await t.app.handle(new Request(`${BASE}/`))).text()
    expect(page).toContain('logo-mark')
    expect(page).toContain('login-brand')
  })
})
