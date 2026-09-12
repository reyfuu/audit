/**
 * Uji jalur masuk auditor yang baru diundang dan halaman akun (FR-02, FR-04).
 *
 * Ini menutup jalan buntu yang nyata: anggota tim yang diundang belum punya
 * kata sandi sama sekali, sehingga ia harus bisa masuk lewat kode email lalu
 * menetapkan kata sandinya sendiri.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../../api/src/app'
import { hashPassword } from '../../api/src/lib/auth'
import { createWebApp } from '../src/app'

const BASE = 'http://localhost:3000'
const SANDI = 'sandiAuditor123'

async function setup() {
  const kode: { email: string; code: string }[] = []
  const { app: apiApp, repo } = createApp({
    baseUrl: BASE,
    sendOtp: (email, code) => { kode.push({ email, code }) },
  })
  const admin = await repo.createAuditor({
    email: 'admin@x.id', name: 'Admin', role: 'auditor_admin', password_hash: hashPassword(SANDI),
  })
  const raw = (path: string, init: RequestInit = {}, token?: string) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }))
  const app = createWebApp({ raw, publicBase: BASE })

  /** Klien peramban sederhana dengan cookie jar. */
  function klien() {
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
    return { get, post, punyaCookie: () => cookie !== '' }
  }

  const utama = klien()
  await utama.post('/', { email: admin.email, password: SANDI })
  return { app, repo, admin, kode, raw, klien, get: utama.get, post: utama.post }
}

/** Masuk memakai kode sekali pakai, seperti anggota baru. */
async function masukDenganKode(
  t: Awaited<ReturnType<typeof setup>>, k: ReturnType<Awaited<ReturnType<typeof setup>>['klien']>,
  email: string,
) {
  const minta = await k.post('/masuk/kode', { email })
  const html = await minta.text()
  const challenge = /name="challenge_id" value="([^"]+)"/.exec(html)?.[1] ?? ''
  const code = t.kode.at(-1)?.code ?? '000000'
  return { res: await k.post('/masuk/kode/verifikasi', { challenge_id: challenge, email, code }), html }
}

describe('FR-04 undangan anggota tim dapat diselesaikan sampai bisa masuk', () => {
  it('anggota yang diundang masuk lewat kode lalu menetapkan kata sandi', async () => {
    const t = await setup()

    // 1. Admin mengundang lewat UI.
    const undang = await t.post('/app/akun/undang', { email: 'rekan@x.id', role: 'auditor' })
    expect(undang.headers.get('location')).toContain('ok=undang')

    // 2. Anggota baru masuk dengan kode dari email.
    const anggota = t.klien()
    const { res } = await masukDenganKode(t, anggota, 'rekan@x.id')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/app/akun')

    // 3. Ia dapat menetapkan kata sandi tanpa kata sandi lama.
    const set = await anggota.post('/app/akun/sandi', {
      current_password: '', new_password: 'sandiBaruPanjang1',
    })
    expect(set.headers.get('location')).toContain('ok=sandi')

    // 4. Sejak itu ia dapat masuk seperti auditor lain.
    const biasa = t.klien()
    const login = await biasa.post('/', { email: 'rekan@x.id', password: 'sandiBaruPanjang1' })
    expect(login.headers.get('location')).toBe('/app')
  })

  it('halaman masuk menunjuk jalur kode untuk yang belum punya kata sandi', async () => {
    const t = await setup()
    const page = await (await t.klien().get('/')).text()
    expect(page).toContain('/masuk/kode')
  })

  it('email yang tidak diundang tetap melihat layar kode, tetapi tidak pernah masuk', async () => {
    const t = await setup()
    const asing = t.klien()
    const { res, html } = await masukDenganKode(t, asing, 'orangasing@x.id')
    // Layar kode tetap muncul: halaman ini tidak boleh membocorkan siapa auditor.
    expect(html).toContain('name="challenge_id"')
    expect(res.status).toBe(401)
    expect(asing.punyaCookie()).toBe(false)
  })

  it('kode yang salah ditolak tanpa membuka sesi', async () => {
    const t = await setup()
    await t.post('/app/akun/undang', { email: 'rekan2@x.id', role: 'auditor' })
    const k = t.klien()
    const minta = await k.post('/masuk/kode', { email: 'rekan2@x.id' })
    const challenge = /name="challenge_id" value="([^"]+)"/.exec(await minta.text())?.[1] ?? ''
    const res = await k.post('/masuk/kode/verifikasi', {
      challenge_id: challenge, email: 'rekan2@x.id', code: '999999',
    })
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('Kode tidak valid')
    expect(k.punyaCookie()).toBe(false)
  })
})

describe('FR-02 halaman akun', () => {
  it('mengganti kata sandi menuntut kata sandi lama dan melaporkan kegagalan', async () => {
    const t = await setup()
    const gagal = await t.post('/app/akun/sandi', { new_password: 'sandiBaruPanjang1' })
    expect(gagal.headers.get('location')).toContain('gagal=')

    const ok = await t.post('/app/akun/sandi', {
      current_password: SANDI, new_password: 'sandiBaruPanjang1',
    })
    expect(ok.headers.get('location')).toContain('ok=sandi')
  })

  it('menolak kata sandi terlalu pendek dengan pesan dari server', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/sandi', {
      current_password: SANDI, new_password: 'pendek',
    })
    expect(decodeURIComponent(res.headers.get('location')!)).toContain('minimal 10 karakter')
  })

  it('auditor biasa tidak melihat formulir undangan tim', async () => {
    const t = await setup()
    await t.repo.createAuditor({
      email: 'biasa@x.id', name: 'Biasa', role: 'auditor', password_hash: hashPassword(SANDI),
    })
    const k = t.klien()
    await k.post('/', { email: 'biasa@x.id', password: SANDI })
    const page = await (await k.get('/app/akun')).text()
    expect(page).toContain('Hanya admin auditor')
    expect(page).not.toContain('action="/app/akun/undang"')
  })

  it('halaman akun dapat dijangkau dari sidebar setiap halaman', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    expect(page).toContain('href="/app/akun"')
  })

  it('tanpa sesi, halaman akun mengarah ke halaman masuk', async () => {
    const t = await setup()
    const res = await t.klien().get('/app/akun')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })
})
