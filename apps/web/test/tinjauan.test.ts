/**
 * Uji halaman tinjauan AI dan perilaku dashboard pada skala banyak perusahaan
 * (FR-31, FR-32, FR-29).
 */
import { describe, it, expect } from 'bun:test'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import type { ChatClient } from '@siapai/ai'
import { createApp } from '../../api/src/app'
import { hashPassword } from '../../api/src/lib/auth'
import { createWebApp } from '../src/app'

const BASE = 'http://localhost:3000'
const SANDI = 'sandiAuditor123'

const BALASAN = JSON.stringify({
  data_quality: 48,
  summary: 'Banyak klaim tanpa bukti pendukung.',
  flags: [{
    question_codes: ['DAT-01'], severity: 'high',
    issue: 'Data diklaim terpusat namun proses masih manual',
    follow_up: 'Minta tangkapan layar sistem yang dipakai',
  }],
  next_checks: ['Verifikasi sumber data penjualan'],
})

function stubChat(reply = BALASAN) {
  const calls: string[] = []
  const client: ChatClient = {
    model: 'ag/gemini-3.8-flash-medium',
    async complete(messages) { calls.push(messages.at(-1)!.content); return reply },
  }
  return { client, calls }
}

async function setup(chat?: ChatClient) {
  const { app: apiApp, repo } = createApp({ baseUrl: BASE, ...(chat ? { chat } : {}) })
  const auditor = await repo.createAuditor({
    email: 'd@x.id', name: 'Dimas', role: 'auditor', password_hash: hashPassword(SANDI),
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

  await post('/masuk', { email: 'd@x.id', password: SANDI })
  return { app, repo, auditor, raw, get, post }
}

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

/** Perusahaan + undangan; opsional diisi penuh lalu dikirim. */
async function perusahaan(
  t: Awaited<ReturnType<typeof setup>>, nama: string, selesai = false,
) {
  await t.post('/app/perusahaan', {
    name: nama, industry: 'retail_ecommerce', employee_band: '50_99',
  })
  const { items } = await (await t.raw('/companies', {},
    await tokenAuditor(t))).json() as { items: { id: string; name: string }[] }
  const c = items.find((x) => x.name === nama)!
  const res = await t.post('/app/undangan', { company_id: c.id })
  const id = res.headers.get('location')!.split('/').pop()!
  const detail = await (await t.get(`/app/undangan/${id}`)).text()
  const token = /\/f\/([A-Za-z0-9_-]+)/.exec(detail)![1]!

  if (selesai) {
    for (let i = 0; i < 60; i++) {
      const s = await (await t.raw(`/f/${token}/next`)).json()
      const sudah = new Set(s.answers.map((a: { question_code: string }) => a.question_code))
      const kurang = (s.questions as Question[]).filter((q) => !sudah.has(q.code))
      if (kurang.length === 0) {
        const rev = await (await t.raw(`/f/${token}/review`)).json()
        if (rev.missing.length === 0) break
        const dim = QN.questions.find((q) => q.code === rev.missing[0])!.dimension_code
        const sec = await (await t.raw(`/f/${token}/next?section=${dim}`)).json()
        await t.raw(`/f/${token}/answers`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            answers: (sec.questions as Question[])
              .filter((q) => rev.missing.includes(q.code))
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
  return { id, token, company: c }
}

/** Access token auditor untuk pemanggilan API langsung di dalam uji. */
async function tokenAuditor(t: Awaited<ReturnType<typeof setup>>) {
  const res = await t.raw('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'd@x.id', password: SANDI }),
  })
  return (await res.json() as { access_token: string }).access_token
}

/** Isi seluruh <tbody> pada halaman, tempat daftar sesungguhnya berada. */
const tabel = (html: string) =>
  [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1]).join('\n')

describe('FR-31 halaman tinjauan AI', () => {
  it('menjelaskan bahwa skor tetap dari rubrik, AI hanya menilai kualitas jawaban', async () => {
    const t = await setup(stubChat().client)
    const page = await (await t.get('/app/tinjauan')).text()
    expect(page).toContain('rubrik')
  })

  it('tombol tinjau menghasilkan temuan yang tampil di halaman undangan', async () => {
    const chat = stubChat()
    const t = await setup(chat.client)
    const p = await perusahaan(t, 'PT Ditinjau', true)

    const sebelum = await (await t.get(`/app/undangan/${p.id}`)).text()
    expect(sebelum).toContain('Belum ditinjau')

    await t.post(`/app/undangan/${p.id}/tinjau`)
    const sesudah = await (await t.get(`/app/undangan/${p.id}`)).text()
    expect(sesudah).toContain('48/100')
    expect(sesudah).toContain('Data diklaim terpusat')
    expect(sesudah).toContain('Perlu segera')
    expect(sesudah).toContain('Minta tangkapan layar')
    expect(chat.calls).toHaveLength(1)
  })

  it('tinjauan massal memproses antrean dan hasilnya tampil di daftar', async () => {
    const chat = stubChat()
    const t = await setup(chat.client)
    await perusahaan(t, 'PT Satu', true)
    await perusahaan(t, 'PT Dua', true)

    const sebelum = await (await t.get('/app/tinjauan')).text()
    expect(sebelum).toContain('Tinjau 2 assessment')

    await t.post('/app/tinjauan/jalankan')
    const sesudah = await (await t.get('/app/tinjauan')).text()
    expect(chat.calls).toHaveLength(2)
    expect(sesudah).toContain('48/100')
    expect(tabel(sesudah)).not.toContain('Belum ditinjau')
  })

  it('tanpa laporan selesai, halaman mengatakannya apa adanya', async () => {
    const t = await setup(stubChat().client)
    await perusahaan(t, 'PT Belum Isi')
    const page = await (await t.get('/app/tinjauan')).text()
    expect(page).toContain('Belum ada laporan selesai')
  })

  it('tanpa konfigurasi model, tombol tinjau tidak membuat halaman rusak', async () => {
    const t = await setup()
    const p = await perusahaan(t, 'PT Tanpa AI', true)
    const res = await t.post(`/app/undangan/${p.id}/tinjau`)
    expect(res.status).toBe(303)
    const page = await (await t.get(`/app/undangan/${p.id}`)).text()
    expect(page).toContain('Belum ditinjau')
  })
})

describe('FR-29 dashboard pada banyak perusahaan', () => {
  it('daftar dipaginasi sehingga halaman tidak membengkak', async () => {
    const t = await setup()
    const token = await tokenAuditor(t)
    // 30 perusahaan dibuat langsung lewat repo: yang diuji adalah tampilannya.
    for (let i = 1; i <= 30; i++) {
      await t.repo.createCompany({
        owner_auditor_id: t.auditor.id, name: `PT Nomor ${String(i).padStart(2, '0')}`,
        industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
      })
    }
    expect(token).toBeString()

    const h1 = await (await t.get('/app/perusahaan')).text()
    expect(h1).toContain('PT Nomor 01')
    expect(h1).not.toContain('PT Nomor 30')
    expect(h1).toContain('Halaman 1 dari 2')

    const h2 = await (await t.get('/app/perusahaan?page=2')).text()
    expect(h2).toContain('PT Nomor 30')
  })

  it('pencarian menyaring daftar perusahaan', async () => {
    const t = await setup()
    for (const nama of ['PT Alfa Sentosa', 'PT Beta Jaya', 'CV Gamma']) {
      await t.repo.createCompany({
        owner_auditor_id: t.auditor.id, name: nama,
        industry: 'fnb', employee_band: '10_49', country: 'ID',
      })
    }
    const page = await (await t.get('/app/perusahaan?q=beta')).text()
    expect(page).toContain('PT Beta Jaya')
    expect(page).not.toContain('PT Alfa Sentosa')
  })

  it('undangan dapat disaring berdasarkan status', async () => {
    const t = await setup()
    await perusahaan(t, 'PT Selesai Satu', true)
    await perusahaan(t, 'PT Baru Saja')

    // Hanya isi tabel yang diperiksa: dropdown penerbitan memang memuat semua
    // perusahaan, dan itu perilaku yang diinginkan.
    const selesai = tabel(await (await t.get('/app/undangan?status=SCORED')).text())
    expect(selesai).toContain('PT Selesai Satu')
    expect(selesai).not.toContain('PT Baru Saja')

    const terkirim = tabel(await (await t.get('/app/undangan?status=SENT')).text())
    expect(terkirim).toContain('PT Baru Saja')
    expect(terkirim).not.toContain('PT Selesai Satu')
  })

  it('ringkasan menghitung status dan menyorot yang macet', async () => {
    const t = await setup()
    await perusahaan(t, 'PT Selesai', true)
    const belum = await perusahaan(t, 'PT Berjalan')
    // Satu jawaban saja: progres jauh di bawah setengah.
    await t.raw(`/f/${belum.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: [{ question_code: 'DAT-01', value: { choice: 'opt_75' } }],
      }),
    })
    const page = await (await t.get('/app')).text()
    expect(page).toContain('Perlu ditindaklanjuti')
    expect(page).toContain('PT Berjalan')
    expect(page).toContain('Laporan siap')
  })
})
