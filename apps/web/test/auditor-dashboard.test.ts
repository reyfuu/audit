/**
 * Uji dashboard auditor (FR-23, FR-24, FR-27, FR-29).
 * Menelusuri HTML seperti browser, sama seperti uji form responden.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../../api/src/app'
import { auditorModule } from '../src/auditor'
import { createWeb } from '../src/web'
import { Elysia } from 'elysia'

const BASE = 'http://localhost:3000'

async function setup() {
  const { app: apiApp, repo } = createApp({ baseUrl: BASE })
  const auditor = await repo.createAuditor({ email: 'd@x.id', name: 'Dimas', role: 'auditor_admin' })
  const lain = await repo.createAuditor({ email: 'o@x.id', name: 'Other', role: 'auditor' })

  const asAuditor = (id: string) => (path: string, init: RequestInit = {}) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer user:${id}` },
    }))
  const publik = (path: string, init?: RequestInit) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, init))

  const app = new Elysia()
    .use(auditorModule({ api: asAuditor(auditor.id), publicBase: BASE }))
    .use(createWeb({ api: publik }))

  const get = (p: string) => app.handle(new Request(`${BASE}${p}`))
  const post = (p: string, form: Record<string, string>) =>
    app.handle(new Request(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }))

  return { app, repo, auditor, lain, get, post, api: asAuditor(auditor.id), apiAs: asAuditor, publik }
}

/** Nilai jawaban terbaik untuk sebuah pertanyaan. */
function nilaiTertinggi(q: {
  type: string; options?: { code: string; score: number }[]; max?: number
}) {
  switch (q.type) {
    case 'single_choice': {
      const s = [...(q.options ?? [])].sort((a, b) => a.score - b.score)
      return { choice: s[s.length - 1]!.code }
    }
    case 'multi_choice': return { choices: (q.options ?? []).map((o) => o.code) }
    case 'scale_1_5': return { scale: 5 }
    case 'boolean': return { bool: true }
    case 'number': return { number: q.max ?? 100 }
    default: return { text: '' }
  }
}

async function tambahPerusahaan(t: Awaited<ReturnType<typeof setup>>, name = 'PT Coba') {
  await t.post('/app/perusahaan', { name, industry: 'retail_ecommerce', employee_band: '50_99' })
  const { items } = await (await t.api('/companies')).json() as { items: { id: string; name: string }[] }
  return items.find((c) => c.name === name)!
}

describe('FR-29 dashboard auditor', () => {
  it('menampilkan pesan kosong yang jelas saat belum ada undangan', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    expect(page).toContain('Belum ada undangan')
  })

  it('perusahaan yang ditambahkan muncul di pilihan penerbitan', async () => {
    const t = await setup()
    await tambahPerusahaan(t, 'PT Sinar Abadi')
    const page = await (await t.get('/app')).text()
    expect(page).toContain('PT Sinar Abadi')
  })

  it('menerbitkan undangan mengarahkan ke halaman detail berisi QR', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id, recipient_name: 'Pak Budi' })
    expect(res.status).toBe(303)
    const detail = await (await t.get(res.headers.get('location')!)).text()
    expect(detail).toContain('Pindai dari HP')
    expect(detail).toMatch(/src="\/app\/undangan\/[^"]+\/qr\.png"/)
  })

  it('status dan progres tampil di daftar', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    await t.post('/app/undangan', { company_id: c.id, recipient_name: 'Bu Sari' })
    const page = await (await t.get('/app')).text()
    expect(page).toContain('Terkirim')
    expect(page).toContain('Bu Sari')
    expect(page).toMatch(/0\/\d+/)
  })

  it('status berubah mengikuti aksi responden', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const detail = await (await t.get(res.headers.get('location')!)).text()
    const link = /http:\/\/localhost:3000\/f\/([A-Za-z0-9_-]+)/.exec(detail)![1]!

    await t.publik(`/f/${link}`)
    expect(await (await t.get('/app')).text()).toContain('Sudah dibuka')

    await t.publik(`/f/${link}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'DAT-01', value: { choice: 'opt_75' } }] }),
    })
    const page = await (await t.get('/app')).text()
    expect(page).toContain('Sedang diisi')
    expect(page).toMatch(/1\/\d+/)
  })
})

describe('FR-24 QR di dashboard', () => {
  it('endpoint QR dashboard mengembalikan PNG sungguhan', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!
    const qr = await t.get(`/app/undangan/${id}/qr.png`)
    expect(qr.status).toBe(200)
    expect(qr.headers.get('content-type')).toBe('image/png')
    const buf = new Uint8Array(await qr.arrayBuffer())
    // Signature PNG: 89 50 4E 47
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('QR punya teks alternatif yang menyebut nama perusahaan', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t, 'PT Alt Teks')
    const res = await t.post('/app/undangan', { company_id: c.id })
    const detail = await (await t.get(res.headers.get('location')!)).text()
    expect(detail).toContain('alt="QR code undangan untuk PT Alt Teks"')
  })

  it('QR dashboard tidak boleh di-cache', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!
    const qr = await t.get(`/app/undangan/${id}/qr.png`)
    expect(qr.headers.get('cache-control')).toContain('no-store')
  })
})

describe('auditor dapat menyalin kembali tautan undangan', () => {
  it('halaman detail menampilkan tautan, bukan memaksa terbitkan ulang', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const detail = await (await t.get(res.headers.get('location')!)).text()
    expect(detail).toMatch(/http:\/\/localhost:3000\/f\/[A-Za-z0-9_-]{20,}/)
  })

  it('tautan yang ditampilkan benar-benar membuka form', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t, 'PT Tautan Sahih')
    const res = await t.post('/app/undangan', { company_id: c.id })
    const detail = await (await t.get(res.headers.get('location')!)).text()
    const url = /http:\/\/localhost:3000\/f\/[A-Za-z0-9_-]+/.exec(detail)![0]
    const form = await (await t.get(new URL(url).pathname)).text()
    expect(form).toContain('PT Tautan Sahih')
  })

  it('undangan yang dicabut tidak lagi menampilkan tautan', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!
    await t.api(`/invitations/${id}`, { method: 'DELETE' })
    const detail = await (await t.get(`/app/undangan/${id}`)).text()
    expect(detail).toContain('Dicabut')
    expect(detail).not.toMatch(/http:\/\/localhost:3000\/f\/[A-Za-z0-9_-]{20,}/)
  })
})

describe('FR-27 terbitkan ulang dari dashboard', () => {
  it('menghasilkan token baru dan mematikan yang lama', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!
    const lamaHtml = await (await t.get(`/app/undangan/${id}`)).text()
    const lama = /\/f\/([A-Za-z0-9_-]+)/.exec(lamaHtml)![1]!

    const re = await t.post(`/app/undangan/${id}/reissue`, {})
    expect(re.status).toBe(303)
    const baruHtml = await (await t.get(re.headers.get('location')!)).text()
    const baru = /\/f\/([A-Za-z0-9_-]+)/.exec(baruHtml)![1]!

    expect(baru).not.toBe(lama)
    expect((await t.publik(`/f/${lama}`)).status).toBe(404)
    expect((await t.publik(`/f/${baru}`)).status).toBe(200)
  })
})

describe('FR-23 AC4 satu undangan aktif per perusahaan', () => {
  it('penerbitan kedua diarahkan ke undangan yang sedang berjalan, bukan buntu', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const pertama = await t.post('/app/undangan', { company_id: c.id })
    const kedua = await t.post('/app/undangan', { company_id: c.id })
    expect(kedua.status).toBe(303)
    expect(kedua.headers.get('location')).toBe(pertama.headers.get('location'))
  })
})

describe('isolasi antar auditor', () => {
  it('dashboard auditor lain kosong dan tidak dapat membuka undangan orang lain', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t)
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!

    // Dashboard terpisah yang memakai identitas auditor kedua.
    const dashLain = new Elysia().use(auditorModule({
      api: (p, init = {}) => t.apiAs(t.lain.id)(p, init),
      publicBase: BASE,
    }))
    const getLain = (p: string) => dashLain.handle(new Request(`${BASE}${p}`))

    const daftar = await (await getLain('/app')).text()
    expect(daftar).toContain('Belum ada undangan')
    expect(daftar).not.toContain('PT Coba')

    const detail = await getLain(`/app/undangan/${id}`)
    expect(detail.status).toBe(404)

    // QR pun tidak boleh bocor ke auditor lain.
    expect((await getLain(`/app/undangan/${id}/qr.png`)).status).toBe(404)
  })
})

describe('auditor dapat membuka laporan setelah responden selesai', () => {
  it('menampilkan tautan laporan begitu status menjadi Selesai', async () => {
    const t = await setup()
    const c = await tambahPerusahaan(t, 'PT Sudah Selesai')
    const res = await t.post('/app/undangan', { company_id: c.id })
    const id = res.headers.get('location')!.split('/').pop()!
    const detail1 = await (await t.get(`/app/undangan/${id}`)).text()
    const token = /\/f\/([A-Za-z0-9_-]+)/.exec(detail1)![1]!

    // Sebelum selesai, belum ada blok hasil.
    expect(detail1).not.toContain('Hasil sudah tersedia')

    // Isi sampai tuntas lalu kirim.
    for (let i = 0; i < 60; i++) {
      const s = await (await t.publik(`/f/${token}/next`)).json()
      const sudah = new Set(s.answers.map((a: { question_code: string }) => a.question_code))
      const kurang = s.questions.filter((q: { code: string }) => !sudah.has(q.code))
      if (kurang.length === 0) {
        const rev = await (await t.publik(`/f/${token}/review`)).json()
        if (rev.missing.length === 0) break
        const dim = rev.missing[0].startsWith('ORG') ? 'ORG' : rev.missing[0].slice(0, 3)
        const sec = await (await t.publik(`/f/${token}/next?section=${dim}`)).json()
        await t.publik(`/f/${token}/answers`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            answers: sec.questions
              .filter((q: { code: string }) => rev.missing.includes(q.code))
              .map((q: { code: string; options?: { code: string }[] }) => ({
                question_code: q.code,
                value: nilaiTertinggi(q as never),
              })),
          }),
        })
        continue
      }
      await t.publik(`/f/${token}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: kurang.map((q: { code: string }) => ({
            question_code: q.code, value: nilaiTertinggi(q as never),
          })),
        }),
      })
    }
    await t.publik(`/f/${token}/submit`, { method: 'POST' })

    const detail2 = await (await t.get(`/app/undangan/${id}`)).text()
    expect(detail2).toContain('Selesai')
    expect(detail2).toContain('Hasil sudah tersedia')
    expect(detail2).toContain('Lihat laporan')
    expect(detail2).toMatch(/\/f\/[A-Za-z0-9_-]+\/hasil/)
  })
})

describe('label dalam bahasa manusia', () => {
  it('pilihan industri memakai label, bukan nilai enum mentah', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    expect(page).toContain('Retail &amp; e-commerce')
    expect(page).toContain('Makanan &amp; minuman')
    expect(page).not.toMatch(/>retail_ecommerce</)
    expect(page).not.toMatch(/>fnb</)
  })

  it('pilihan jumlah karyawan terbaca manusia', async () => {
    const t = await setup()
    const page = await (await t.get('/app')).text()
    expect(page).toContain('50–99 orang')
    expect(page).toContain('1000 orang atau lebih')
    expect(page).not.toMatch(/>1000_plus</)
  })
})

describe('keamanan output dashboard', () => {
  it('nama perusahaan berisi HTML di-escape', async () => {
    const t = await setup()
    const c = await t.repo.createCompany({
      owner_auditor_id: t.auditor.id, name: '<img src=x onerror=alert(1)>',
      industry: 'fnb', employee_band: '10_49', country: 'ID',
    })
    await t.post('/app/undangan', { company_id: c.id })
    const page = await (await t.get('/app')).text()
    expect(page).not.toContain('<img src=x onerror=alert(1)>')
    expect(page).toContain('&lt;img')
  })
})
