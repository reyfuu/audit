/**
 * Uji CRUD perusahaan, pembaruan profil, dan tautan kembali di laporan
 * (FR-05, FR-33, FR-16).
 *
 * Fokusnya pada hal yang benar-benar bisa merugikan: data auditor lain tidak
 * boleh tersentuh, penghapusan tidak boleh terjadi karena satu klik tak
 * sengaja, dan jalan menuju dashboard tidak boleh bocor ke responden.
 */
import { describe, it, expect } from 'bun:test'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../../api/src/app'
import { hashPassword } from '../../api/src/lib/auth'
import { createWebApp } from '../src/app'

const BASE = 'http://localhost:3000'
const SANDI = 'sandiAuditor123'

async function setup() {
  const { app: apiApp, repo } = createApp({ baseUrl: BASE })
  const auditor = await repo.createAuditor({
    email: 'd@x.id', name: 'Dimas', role: 'auditor_admin', password_hash: hashPassword(SANDI),
  })
  const lain = await repo.createAuditor({
    email: 'o@x.id', name: 'Other', role: 'auditor', password_hash: hashPassword(SANDI),
  })
  const raw = (path: string, init: RequestInit = {}, token?: string) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }))
  const app = createWebApp({ raw, publicBase: BASE })

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
    return {
      get, post,
      masuk: (email: string) => post('/', { email, password: SANDI }),
      cookie: () => cookie,
    }
  }

  const utama = klien()
  await utama.masuk(auditor.email)
  return { app, repo, auditor, lain, raw, klien, get: utama.get, post: utama.post }
}

type T = Awaited<ReturnType<typeof setup>>

/** Menambah perusahaan lewat UI dan mengembalikan id-nya. */
async function tambah(t: T, nama: string): Promise<string> {
  await t.post('/app/perusahaan', {
    name: nama, industry: 'retail_ecommerce', employee_band: '50_99',
  })
  const daftar = await (await t.get('/app/perusahaan')).text()
  const cocok = [...daftar.matchAll(/href="\/app\/perusahaan\/([a-f0-9-]{36})"/g)]
  // Baris terbaru berada di atas; ambil yang barisnya memuat nama ini.
  for (const m of cocok) {
    const halaman = await (await t.get(`/app/perusahaan/${m[1]}`)).text()
    if (halaman.includes(nama)) return m[1]!
  }
  throw new Error(`perusahaan ${nama} tidak ditemukan`)
}

describe('FR-05 ubah perusahaan', () => {
  it('perubahan nama dan industri tersimpan dan tampil di daftar', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Nama Lama')

    const res = await t.post(`/app/perusahaan/${id}`, {
      name: 'PT Nama Baru', industry: 'healthcare', employee_band: '100_499',
    })
    expect(res.headers.get('location')).toContain('ok=1')

    // Ikuti pengalihan seperti peramban, agar banner konfirmasinya ikut terbaca.
    const halaman = await (await t.get(res.headers.get('location')!)).text()
    expect(halaman).toContain('PT Nama Baru')
    expect(halaman).toContain('Perubahan disimpan')
    // Pilihan yang tersimpan harus terpilih kembali saat formulir dibuka.
    expect(halaman).toContain('<option value="healthcare" selected>')
    expect(halaman).toContain('<option value="100_499" selected>')

    const daftar = await (await t.get('/app/perusahaan')).text()
    expect(daftar).toContain('PT Nama Baru')
    expect(daftar).not.toContain('PT Nama Lama')
  })

  it('perusahaan milik auditor lain tidak dapat dibuka maupun diubah', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Milik Saya')

    const penyusup = t.klien()
    await penyusup.masuk(t.lain.email)

    expect((await penyusup.get(`/app/perusahaan/${id}`)).status).toBe(404)

    const ubah = await penyusup.post(`/app/perusahaan/${id}`, {
      name: 'PT Dibajak', industry: 'fnb', employee_band: '1_9',
    })
    expect(ubah.headers.get('location')).toContain('gagal=')

    // Data aslinya tidak tersentuh.
    const asli = await (await t.get(`/app/perusahaan/${id}`)).text()
    expect(asli).toContain('PT Milik Saya')
    expect(asli).not.toContain('PT Dibajak')
  })

  it('nama kosong ditolak dan melaporkan alasannya', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Validasi')
    const res = await t.post(`/app/perusahaan/${id}`, {
      name: 'X', industry: 'fnb', employee_band: '1_9',
    })
    expect(res.headers.get('location')).toContain('gagal=')
    const halaman = await (await t.get(res.headers.get('location')!)).text()
    expect(halaman).toContain('banner-error')
  })
})

describe('FR-05 hapus perusahaan', () => {
  it('menghapus hanya setelah nama diketik ulang dengan benar', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Akan Dihapus')

    // Salah ketik: tidak terjadi apa-apa.
    const salah = await t.post(`/app/perusahaan/${id}/hapus`, { konfirmasi: 'PT Salah Ketik' })
    expect(salah.headers.get('location')).toContain('gagal=')
    expect((await t.get(`/app/perusahaan/${id}`)).status).toBe(200)

    // Benar: terhapus.
    const benar = await t.post(`/app/perusahaan/${id}/hapus`, { konfirmasi: 'PT Akan Dihapus' })
    expect(benar.headers.get('location')).toBe('/app/perusahaan?dihapus=1')
    expect((await t.get(`/app/perusahaan/${id}`)).status).toBe(404)

    const daftar = await (await t.get('/app/perusahaan?dihapus=1')).text()
    expect(daftar).not.toContain('PT Akan Dihapus')
    expect(daftar).toContain('telah dihapus')
  })

  it('undangan dan assessment ikut terhapus, tokennya tidak lagi berlaku', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Beserta Undangan')
    await t.post('/app/undangan', { company_id: id })

    const daftar = await (await t.get('/app/undangan')).text()
    const invId = /href="\/app\/undangan\/([a-f0-9-]{36})"/.exec(daftar)![1]!
    const detail = await (await t.get(`/app/undangan/${invId}`)).text()
    const token = /\/f\/([A-Za-z0-9_-]{20,})/.exec(detail)![1]!

    // Form responden hidup sebelum penghapusan.
    expect((await t.app.handle(new Request(`${BASE}/f/${token}`))).status).toBe(200)

    await t.post(`/app/perusahaan/${id}/hapus`, { konfirmasi: 'PT Beserta Undangan' })

    // Setelah dihapus, tautan yang sudah beredar mati dengan sopan.
    expect((await t.app.handle(new Request(`${BASE}/f/${token}`))).status).toBe(404)
    expect((await t.get(`/app/undangan/${invId}`)).status).toBe(404)
  })

  it('auditor lain tidak dapat menghapus perusahaan yang bukan miliknya', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Terlindungi')

    const penyusup = t.klien()
    await penyusup.masuk(t.lain.email)
    await penyusup.post(`/app/perusahaan/${id}/hapus`, { konfirmasi: 'PT Terlindungi' })

    // Masih utuh bagi pemiliknya.
    expect((await t.get(`/app/perusahaan/${id}`)).status).toBe(200)
  })

  it('memperingatkan bila perusahaan sudah punya laporan selesai', async () => {
    const t = await setup()
    const id = await tambah(t, 'PT Sudah Berlaporan')
    await t.post('/app/undangan', { company_id: id })
    const daftar = await (await t.get('/app/undangan')).text()
    const invId = /href="\/app\/undangan\/([a-f0-9-]{36})"/.exec(daftar)![1]!
    const detail = await (await t.get(`/app/undangan/${invId}`)).text()
    const token = /\/f\/([A-Za-z0-9_-]{20,})/.exec(detail)![1]!
    await isiSampaiSelesai(t, token)

    const halaman = await (await t.get(`/app/perusahaan/${id}`)).text()
    expect(halaman).toContain('sudah punya laporan selesai')
    expect(halaman).toContain('laporan yang sudah jadi')
  })
})

describe('FR-33 perbarui profil sendiri', () => {
  it('nama dan email tersimpan, dan email baru dapat dipakai masuk', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/profil', {
      name: 'Dimas Prasetyo', email: 'dimas.baru@x.id',
    })
    expect(res.headers.get('location')).toContain('ok=profil')

    const halaman = await (await t.get('/app/akun')).text()
    expect(halaman).toContain('Dimas Prasetyo')
    expect(halaman).toContain('dimas.baru@x.id')

    // Email adalah kredensial masuk, jadi yang baru harus benar-benar bekerja.
    const baru = t.klien()
    const masuk = await baru.post('/', { email: 'dimas.baru@x.id', password: SANDI })
    expect(masuk.headers.get('location')).toBe('/app')
  })

  it('email yang sudah dipakai akun lain ditolak dengan alasan jelas', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/profil', { name: 'Dimas', email: t.lain.email })
    expect(res.headers.get('location')).toContain('gagal=')
    expect(decodeURIComponent(res.headers.get('location')!)).toContain('sudah dipakai')

    // Email lama tetap berlaku karena perubahan ditolak.
    const lama = t.klien()
    expect((await lama.post('/', { email: 'd@x.id', password: SANDI }))
      .headers.get('location')).toBe('/app')
  })

  it('nama terlalu pendek ditolak', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/profil', { name: 'D', email: 'd@x.id' })
    expect(decodeURIComponent(res.headers.get('location')!)).toContain('minimal 2 karakter')
  })

  it('mengirim email yang sama dengan milik sendiri tidak dianggap bentrok', async () => {
    const t = await setup()
    const res = await t.post('/app/akun/profil', { name: 'Dimas Tetap', email: 'd@x.id' })
    expect(res.headers.get('location')).toContain('ok=profil')
  })
})

describe('FR-16 tautan kembali di halaman laporan', () => {
  it('auditor yang sedang masuk melihat jalan kembali ke dashboard', async () => {
    const t = await setup()
    const token = await skenarioSelesai(t, 'PT Berlaporan')
    const halaman = await (await t.get(`/f/${token}/hasil`)).text()
    expect(halaman).toContain('Kembali ke dashboard')
    expect(halaman).toContain('href="/app/undangan"')
  })

  it('responden tanpa sesi tidak melihat jalan ke dashboard', async () => {
    const t = await setup()
    const token = await skenarioSelesai(t, 'PT Responden')
    // Dibuka tanpa cookie sama sekali, persis seperti owner dari HP-nya.
    const halaman = await (await t.app.handle(
      new Request(`${BASE}/f/${token}/hasil`))).text()
    expect(halaman).toContain('Hasil audit')
    expect(halaman).not.toContain('Kembali ke dashboard')
    expect(halaman).not.toContain('/app/undangan')
  })

  it('laporan yang dibagikan ke publik juga tidak membocorkan dashboard', async () => {
    const t = await setup()
    const token = await skenarioSelesai(t, 'PT Dibagikan')
    const daftar = await (await t.get('/app/undangan')).text()
    const invId = /href="\/app\/undangan\/([a-f0-9-]{36})"/.exec(daftar)![1]!
    await t.post(`/app/undangan/${invId}/bagikan`)
    const detail = await (await t.get(`/app/undangan/${invId}`)).text()
    const url = /http:\/\/localhost:3000\/l\/[A-Za-z0-9_-]+/.exec(detail)![0]

    const publik = await (await t.app.handle(new Request(url))).text()
    expect(publik).toContain('Hasil audit')
    expect(publik).not.toContain('Kembali ke dashboard')
  })
})

// ── Pembantu

const nilaiTertinggi = (q: Question) => {
  switch (q.type) {
    case 'single_choice': {
      const o = [...(q.options ?? [])].sort((a, b) => a.score - b.score)
      return { choice: o[o.length - 1]!.code }
    }
    case 'multi_choice': return { choices: (q.options ?? []).map((x) => x.code) }
    case 'scale_1_5': return { scale: 5 }
    case 'boolean': return { bool: true }
    case 'number': return { number: q.max ?? 100 }
    default: return { text: '' }
  }
}

/** Mengisi form sampai tuntas lalu mengirimkannya. */
async function isiSampaiSelesai(t: T, token: string) {
  for (let i = 0; i < 60; i++) {
    const s = await (await t.raw(`/f/${token}/next`)).json() as {
      answers: { question_code: string }[]; questions: Question[]
    }
    const sudah = new Set(s.answers.map((a) => a.question_code))
    const kurang = s.questions.filter((q) => !sudah.has(q.code))
    if (kurang.length === 0) {
      const rev = await (await t.raw(`/f/${token}/review`)).json() as { missing: string[] }
      if (rev.missing.length === 0) break
      const dim = QN.questions.find((q) => q.code === rev.missing[0])!.dimension_code
      const sec = await (await t.raw(`/f/${token}/next?section=${dim}`)).json() as {
        questions: Question[]
      }
      await t.raw(`/f/${token}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: sec.questions.filter((q) => rev.missing.includes(q.code))
            .map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
        }),
      })
      continue
    }
    await t.raw(`/f/${token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: kurang.map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
      }),
    })
  }
  await t.raw(`/f/${token}/submit`, { method: 'POST' })
}

/** Perusahaan + undangan yang formnya sudah terisi penuh dan terkirim. */
async function skenarioSelesai(t: T, nama: string): Promise<string> {
  const id = await tambah(t, nama)
  await t.post('/app/undangan', { company_id: id })
  const daftar = await (await t.get('/app/undangan')).text()
  const invId = /href="\/app\/undangan\/([a-f0-9-]{36})"/.exec(daftar)![1]!
  const detail = await (await t.get(`/app/undangan/${invId}`)).text()
  const token = /\/f\/([A-Za-z0-9_-]{20,})/.exec(detail)![1]!
  await isiSampaiSelesai(t, token)
  return token
}
