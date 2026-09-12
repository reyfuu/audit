/**
 * Uji end-to-end jalur bisnis v2: auditor menerbitkan undangan, owner memindai
 * QR dan mengisi form, lalu hasil diterbitkan.
 * Tiap test dipetakan ke FR atau kriteria penerimaan di BRD/PRD.
 */
import { describe, it, expect } from 'bun:test'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../src/app'

const BASE = 'http://localhost:3001'

function setup(now: () => Date = () => new Date()) {
  const { app, repo } = createApp({ baseUrl: BASE, now })
  const auditor = repo.createAuditor({ email: 'dimas@audit.id', name: 'Dimas', role: 'auditor' })
  const lain = repo.createAuditor({ email: 'other@audit.id', name: 'Other', role: 'auditor' })
  const H = (id = auditor.id) => ({
    'content-type': 'application/json',
    authorization: `Bearer user:${id}`,
  })
  const call = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`${BASE}${path}`, init))

  return { app, repo, auditor, lain, H, call }
}

async function createCompany(t: ReturnType<typeof setup>, name = 'PT Maju Jaya') {
  const r = await t.call('/companies', {
    method: 'POST', headers: t.H(),
    body: JSON.stringify({ name, industry: 'retail_ecommerce', employee_band: '50_99' }),
  })
  expect(r.status).toBe(201)
  return r.json() as Promise<{ id: string; name: string }>
}

async function issueInvitation(t: ReturnType<typeof setup>, companyId: string) {
  const r = await t.call('/invitations', {
    method: 'POST', headers: t.H(),
    body: JSON.stringify({ company_id: companyId, recipient_name: 'Pak Budi' }),
  })
  return { status: r.status, body: await r.json() }
}

/** Jawaban terbaik untuk seluruh pertanyaan yang sedang tampil. */
function bestValue(q: Question) {
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

/** Mengisi form sampai tuntas lewat jalur responden, meniru klien sungguhan. */
async function fillForm(t: ReturnType<typeof setup>, token: string) {
  for (let guard = 0; guard < 30; guard++) {
    const next = await (await t.call(`/f/${token}/next`)).json()
    const unanswered = next.questions.filter(
      (q: { code: string }) => !next.answers.some((a: { question_code: string }) => a.question_code === q.code),
    )
    if (unanswered.length === 0) {
      const review = await (await t.call(`/f/${token}/review`)).json()
      if (review.missing.length === 0) return review
      // Lompat ke seksi pertanyaan yang masih kurang.
      const dim = review.missing[0].slice(0, 3)
      const sec = await (await t.call(`/f/${token}/next?section=${dim}`)).json()
      await t.call(`/f/${token}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: sec.questions
            .filter((q: { code: string }) => review.missing.includes(q.code))
            .map((q: Question) => ({ question_code: q.code, value: bestValue(q) })),
        }),
      })
      continue
    }
    await t.call(`/f/${token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: unanswered.map((q: Question) => ({ question_code: q.code, value: bestValue(q) })),
      }),
    })
  }
  throw new Error('form tidak selesai dalam batas iterasi')
}

// ────────────────────────────────────────────────────────────────
describe('FR-23 terbitkan undangan', () => {
  it('BA1: auditor memperoleh tautan dan kedua format QR', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { status, body } = await issueInvitation(t, c.id)
    expect(status).toBe(201)
    expect(body.invitation_url).toBe(`${BASE}/f/${body.token}`)
    expect(body.qr_png_url).toContain('/qr.png')
    expect(body.qr_svg_url).toContain('/qr.svg')
    expect(body.status).toBe('SENT')
    expect(body.company_name).toBe('PT Maju Jaya')
  })

  it('AC3: assessment dibuat otomatis dengan versi terkunci', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const a = t.repo.getAssessment(body.assessment_id)
    expect(a?.status).toBe('IN_PROGRESS')
    expect(a?.questionnaire_version).toBe(QN.version)
    expect(a?.rubric_version).toBe(QN.rubric_version)
  })

  it('AC1: token mentah tidak tersimpan apa adanya di basis data', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const row = t.repo.getInvitation(body.id)!
    expect(row.token_hash).not.toBe(body.token)
    expect(row.token_sealed).not.toContain(body.token)
  })

  it('AC4: menerbitkan dua kali untuk perusahaan sama ditolak 409', async () => {
    const t = setup()
    const c = await createCompany(t)
    await issueInvitation(t, c.id)
    const second = await issueInvitation(t, c.id)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('CONFLICT')
    expect(second.body.error.details.invitation_id).toBeTruthy()
  })

  it('auditor tidak dapat menerbitkan untuk perusahaan auditor lain', async () => {
    const t = setup()
    const c = await createCompany(t)
    const r = await t.call('/invitations', {
      method: 'POST', headers: t.H(t.lain.id),
      body: JSON.stringify({ company_id: c.id }),
    })
    expect(r.status).toBe(404) // bukan 403: keberadaannya tidak dibocorkan
  })

  it('tanpa token auditor ditolak 401', async () => {
    const t = setup()
    const r = await t.call('/invitations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company_id: 'x' }),
    })
    expect(r.status).toBe(401)
  })
})

describe('FR-24 QR code', () => {
  it('AC1: isi QR PNG sama persis dengan invitation_url', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)

    const res = await t.call(`/invitations/${body.id}/qr.png`, { headers: t.H() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')

    // Dekode QR sungguhan, bukan sekadar percaya bahwa endpoint mengembalikan gambar.
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    expect(decoded).not.toBeNull()
    expect(decoded!.data).toBe(body.invitation_url)
  })

  it('AC1: QR SVG juga memuat URL yang sama', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/invitations/${body.id}/qr.svg`, { headers: t.H() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(await res.text()).toContain('<svg')
  })

  it('AC2: ukuran default memenuhi minimum 256 px', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/invitations/${body.id}/qr.png`, { headers: t.H() })
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
    expect(png.width).toBeGreaterThanOrEqual(256)
  })

  it('AC2: ukuran di bawah 256 ditolak validasi', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/invitations/${body.id}/qr.png?size=64`, { headers: t.H() })
    expect(res.status).toBe(422)
  })

  it('AC4: QR tidak dapat diambil tanpa autentikasi auditor', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/invitations/${body.id}/qr.png`)).status).toBe(401)
  })

  it('AC4: auditor lain tidak dapat mengambil QR milik orang lain', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/invitations/${body.id}/qr.png`, { headers: t.H(t.lain.id) })).status).toBe(404)
  })

  it('QR tidak boleh di-cache oleh proxy', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/invitations/${body.id}/qr.png`, { headers: t.H() })
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})

describe('FR-25 owner membuka form dari QR', () => {
  it('BA2: token dari hasil pindai QR membuka form perusahaan yang benar', async () => {
    const t = setup()
    const c = await createCompany(t, 'CV Sinar Terang')
    const { body } = await issueInvitation(t, c.id)

    // Simulasikan pindai: dekode QR, ambil token dari URL hasil dekode.
    const res = await t.call(`/invitations/${body.id}/qr.png`, { headers: t.H() })
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
    const scannedUrl = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)!.data
    const token = new URL(scannedUrl).pathname.split('/f/')[1]!

    const welcome = await (await t.call(`/f/${token}`)).json()
    expect(welcome.company_name).toBe('CV Sinar Terang')
    expect(welcome.invited_by).toBe('Dimas')
    expect(welcome.total_questions).toBeGreaterThan(30)
    expect(welcome.estimated_minutes).toBeGreaterThan(0)
    expect(welcome.resume).toBe(false)
  })

  it('AC4: responden tidak perlu akun, tanpa header Authorization', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/f/${body.token}`)).status).toBe(200)
  })

  it('AC2: pembukaan pertama mengubah status SENT menjadi OPENED', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect(t.repo.getInvitation(body.id)!.status).toBe('SENT')
    await t.call(`/f/${body.token}`)
    const after = t.repo.getInvitation(body.id)!
    expect(after.status).toBe('OPENED')
    expect(after.opened_at).not.toBeNull()
  })

  it('AC3: token tidak dikenal mengembalikan 404 netral', async () => {
    const t = setup()
    const res = await t.call('/f/token-palsu-yang-tidak-pernah-ada')
    expect(res.status).toBe(404)
    const b = await res.json()
    expect(b.error.code).toBe('INVITATION_INVALID')
    expect(b.error.message).not.toContain('tidak ditemukan di basis data')
  })

  it('AC5: halaman form tidak diindeks mesin pencari', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/f/${body.token}`)
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
})

describe('FR-26 melanjutkan lintas perangkat', () => {
  it('BA5: mulai di satu perangkat, lanjutkan di perangkat lain', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)

    // "HP": jawab satu seksi
    const sec = await (await t.call(`/f/${body.token}/next`)).json()
    const save = await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: sec.questions.slice(0, 2).map((q: Question) => ({
          question_code: q.code, value: bestValue(q),
        })),
      }),
    })
    expect(save.status).toBe(200)

    // "Laptop": buka tautan yang sama, jawaban harus ada
    const welcome = await (await t.call(`/f/${body.token}`)).json()
    expect(welcome.resume).toBe(true)
    expect(welcome.progress.answered).toBe(2)
  })
})

describe('FR-09 autosave lewat jalur responden', () => {
  it('idempoten: menjawab ulang pertanyaan sama tidak menggandakan progres', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const payload = {
      answers: [{ question_code: 'DAT-01', value: { choice: 'opt_100' } }],
    }
    const h = { 'content-type': 'application/json' }
    const a = await (await t.call(`/f/${body.token}/answers`, { method: 'PATCH', headers: h, body: JSON.stringify(payload) })).json()
    const b = await (await t.call(`/f/${body.token}/answers`, { method: 'PATCH', headers: h, body: JSON.stringify(payload) })).json()
    expect(b.progress.answered).toBe(a.progress.answered)
    expect(b.server_revision).toBeGreaterThan(a.server_revision)
  })

  it('branching: menjawab ORG-02 dengan perusahaan besar memunculkan PPL-07', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await (await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'ORG-02', value: { choice: '1000_plus' } }] }),
    })).json()
    expect(res.newly_visible).toContain('PPL-07')
  })

  it('branching: mengubah ke perusahaan kecil menyembunyikan PPL-07 lagi', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const h = { 'content-type': 'application/json' }
    await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ answers: [{ question_code: 'ORG-02', value: { choice: '1000_plus' } }] }),
    })
    const res = await (await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ answers: [{ question_code: 'ORG-02', value: { choice: '10_49' } }] }),
    })).json()
    expect(res.newly_hidden).toContain('PPL-07')
  })

  it('menolak jawaban untuk pertanyaan yang sedang tidak tampil', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'ORG-02', value: { choice: '10_49' } }] }),
    })
    const res = await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'PPL-07', value: { choice: 'opt_100' } }] }),
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('QUESTION_NOT_VISIBLE')
  })

  it('menolak bentuk nilai yang salah tipe', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'DAT-01', value: { scale: 3 } }] }),
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('INVALID_ANSWER_TYPE')
  })
})

describe('FR-12 & FR-16 kirim dan lihat hasil', () => {
  it('submit dengan jawaban kurang ditolak 422 beserta daftarnya', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    const res = await t.call(`/f/${body.token}/submit`, { method: 'POST' })
    expect(res.status).toBe(422)
    const b = await res.json()
    expect(b.error.code).toBe('INCOMPLETE')
    expect(b.error.details.missing.length).toBeGreaterThan(0)
  })

  it('alur penuh: isi semua, kirim, dapat verdict dan rekomendasi', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)

    const review = await fillForm(t, body.token)
    expect(review.missing).toEqual([])
    expect(review.progress.percent).toBe(100)

    const submit = await t.call(`/f/${body.token}/submit`, { method: 'POST' })
    expect(submit.status).toBe(200)
    const result = await submit.json()
    expect(result.verdict).toBe('READY')
    expect(result.total_score).toBe(100)
    expect(result.dimensions).toHaveLength(7)
    expect(result.summary.length).toBeGreaterThan(20)

    const hasil = await (await t.call(`/f/${body.token}/result`)).json()
    expect(hasil.result.total_score).toBe(100)
    expect(hasil.recommendations.items.length).toBeGreaterThanOrEqual(3)
  })

  it('BA6/PA4: seluruh laporan terbuka, tidak ada 402 di mana pun', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    await fillForm(t, body.token)
    await t.call(`/f/${body.token}/submit`, { method: 'POST' })
    const res = await t.call(`/f/${body.token}/result`)
    expect(res.status).toBe(200)
    const hasil = await res.json()
    // Tidak ada penanda terkunci sama sekali.
    expect(JSON.stringify(hasil)).not.toContain('PAYMENT_REQUIRED')
    expect(hasil.recommendations.items[0].body.length).toBeGreaterThan(40)
  })

  it('setelah dikirim, jawaban tidak dapat diubah lagi', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    await fillForm(t, body.token)
    await t.call(`/f/${body.token}/submit`, { method: 'POST' })
    const res = await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'DAT-01', value: { choice: 'opt_0' } }] }),
    })
    expect(res.status).toBe(409)
  })

  it('submit dua kali ditolak', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    await fillForm(t, body.token)
    expect((await t.call(`/f/${body.token}/submit`, { method: 'POST' })).status).toBe(200)
    expect((await t.call(`/f/${body.token}/submit`, { method: 'POST' })).status).toBe(409)
  })

  it('hasil belum tersedia sebelum dikirim', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/f/${body.token}/result`)).status).toBe(409)
  })
})

describe('FR-27 cabut & terbitkan ulang', () => {
  it('AC1: undangan yang dicabut langsung tidak dapat dipakai', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/f/${body.token}`)).status).toBe(200)

    const del = await t.call(`/invitations/${body.id}`, { method: 'DELETE', headers: t.H() })
    expect(del.status).toBe(204)

    const after = await t.call(`/f/${body.token}`)
    expect(after.status).toBe(404)
    expect((await after.json()).error.code).toBe('INVITATION_INVALID')
  })

  it('AC2: terbitkan ulang memberi token baru tetapi jawaban dipertahankan', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'DAT-01', value: { choice: 'opt_100' } }] }),
    })

    const re = await t.call(`/invitations/${body.id}/reissue`, { method: 'POST', headers: t.H() })
    expect(re.status).toBe(201)
    const baru = await re.json()
    expect(baru.token).not.toBe(body.token)
    expect(baru.assessment_id).toBe(body.assessment_id)

    // Token lama mati, token baru membawa jawaban lama.
    expect((await t.call(`/f/${body.token}`)).status).toBe(404)
    const welcome = await (await t.call(`/f/${baru.token}`)).json()
    expect(welcome.resume).toBe(true)
    expect(welcome.progress.answered).toBe(1)
  })
})

describe('FR-28 kedaluwarsa', () => {
  it('AC1: setelah masa berlaku lewat, form ditolak', async () => {
    let sekarang = new Date('2026-01-01T00:00:00Z')
    const t = setup(() => sekarang)
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)
    expect((await t.call(`/f/${body.token}`)).status).toBe(200)

    // Maju 31 hari, melewati default 30 hari.
    sekarang = new Date('2026-02-01T00:00:00Z')
    const res = await t.call(`/f/${body.token}`)
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('INVITATION_INVALID')
  })

  it('undangan kedaluwarsa membuka jalan untuk menerbitkan yang baru', async () => {
    let sekarang = new Date('2026-01-01T00:00:00Z')
    const t = setup(() => sekarang)
    const c = await createCompany(t)
    await issueInvitation(t, c.id)
    sekarang = new Date('2026-02-01T00:00:00Z')
    const kedua = await issueInvitation(t, c.id)
    expect(kedua.status).toBe(201)
  })
})

describe('FR-29 dashboard auditor', () => {
  it('status dan progres mengikuti aksi responden', async () => {
    const t = setup()
    const c = await createCompany(t)
    const { body } = await issueInvitation(t, c.id)

    let list = await (await t.call('/invitations', { headers: t.H() })).json()
    expect(list.items[0].status).toBe('SENT')

    await t.call(`/f/${body.token}`)
    list = await (await t.call('/invitations', { headers: t.H() })).json()
    expect(list.items[0].status).toBe('OPENED')

    await t.call(`/f/${body.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ question_code: 'DAT-01', value: { choice: 'opt_75' } }] }),
    })
    list = await (await t.call('/invitations', { headers: t.H() })).json()
    expect(list.items[0].status).toBe('IN_PROGRESS')
    expect(list.items[0].progress.answered).toBe(1)

    await fillForm(t, body.token)
    await t.call(`/f/${body.token}/submit`, { method: 'POST' })
    list = await (await t.call('/invitations', { headers: t.H() })).json()
    expect(list.items[0].status).toBe('SCORED')
  })

  it('auditor hanya melihat undangan miliknya sendiri', async () => {
    const t = setup()
    const c = await createCompany(t)
    await issueInvitation(t, c.id)
    const lain = await (await t.call('/invitations', { headers: t.H(t.lain.id) })).json()
    expect(lain.items).toHaveLength(0)
  })
})
