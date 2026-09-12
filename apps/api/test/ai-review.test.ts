import '../test/setup-dev-tokens'
/**
 * Uji modul tinjauan AI (FR-31, FR-32).
 *
 * Model diganti stub: yang perlu dibuktikan adalah kepemilikan data, caching
 * snapshot, dan perilaku jujur saat model tidak tersedia — bukan kecerdasan
 * modelnya.
 */
import { describe, expect, it } from 'bun:test'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import type { ChatClient } from '@siapai/ai'
import { createApp } from '../src/app'
import { createMemoryRepo } from '../src/lib/repo'
import { answerText, buildReviewInput } from '../src/modules/ai-review'

const BASE = 'http://localhost:3001'

const BALASAN = JSON.stringify({
  data_quality: 72,
  summary: 'Jawaban konsisten, sebagian klaim perlu bukti.',
  flags: [{
    question_codes: ['DAT-01'], severity: 'medium',
    issue: 'Klaim data terpusat tanpa bukti', follow_up: 'Minta contoh dashboard',
  }],
  next_checks: ['Verifikasi kepemilikan data'],
})

/** Klien model palsu yang mencatat berapa kali dipanggil. */
function stubChat(reply: string | (() => string) = BALASAN) {
  const calls: string[] = []
  const client: ChatClient = {
    model: 'ag/gemini-3.8-flash-medium',
    async complete(messages) {
      calls.push(messages.at(-1)!.content)
      return typeof reply === 'function' ? reply() : reply
    },
  }
  return { client, calls }
}

function setup(chat?: ChatClient) {
  const repo = createMemoryRepo()
  const { app } = createApp({ repo, baseUrl: BASE, ...(chat ? { chat } : {}) })
  const call = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`${BASE}${path}`, init))
  const asAuditor = (id: string) => ({ authorization: `Bearer user:${id}` })
  return { app, repo, call, asAuditor }
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

/** Satu assessment terisi penuh dan sudah dikirim. */
async function skenario(t: ReturnType<typeof setup>, kirim = true) {
  const auditor = await t.repo.createAuditor({ email: 'a@x.id', name: 'Dimas', role: 'auditor' })
  const lain = await t.repo.createAuditor({ email: 'b@x.id', name: 'Other', role: 'auditor' })
  const company = await t.repo.createCompany({
    owner_auditor_id: auditor.id, name: 'PT Tinjau',
    industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
  })
  const inv = await (await t.call('/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...t.asAuditor(auditor.id) },
    body: JSON.stringify({ company_id: company.id }),
  })).json() as { token: string; assessment_id: string }

  for (let i = 0; i < 60; i++) {
    const s = await (await t.call(`/f/${inv.token}/next`)).json()
    const sudah = new Set(s.answers.map((a: { question_code: string }) => a.question_code))
    const kurang = (s.questions as Question[]).filter((q) => !sudah.has(q.code))
    if (kurang.length === 0) {
      const rev = await (await t.call(`/f/${inv.token}/review`)).json()
      if (rev.missing.length === 0) break
      const dim = QN.questions.find((q) => q.code === rev.missing[0])!.dimension_code
      const sec = await (await t.call(`/f/${inv.token}/next?section=${dim}`)).json()
      await t.call(`/f/${inv.token}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: (sec.questions as Question[])
            .filter((q) => rev.missing.includes(q.code))
            .map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
        }),
      })
      continue
    }
    await t.call(`/f/${inv.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: kurang.map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
      }),
    })
  }
  if (kirim) await t.call(`/f/${inv.token}/submit`, { method: 'POST' })
  return { auditor, lain, company, assessmentId: inv.assessment_id }
}

describe('FR-31 tinjauan AI satu assessment', () => {
  it('menghasilkan temuan dan menyimpannya sebagai snapshot', async () => {
    const chat = stubChat()
    const t = setup(chat.client)
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(200)
    const r = await res.json()
    expect(r.data_quality).toBe(72)
    expect(r.flags[0].question_codes).toEqual(['DAT-01'])
    expect(r.model).toBe('ag/gemini-3.8-flash-medium')

    // Tersimpan: dapat dibaca lagi tanpa memanggil model.
    const lagi = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      headers: t.asAuditor(s.auditor.id),
    })
    expect((await lagi.json()).data_quality).toBe(72)
    expect(chat.calls).toHaveLength(1)
  })

  it('tidak memanggil model dua kali tanpa refresh eksplisit', async () => {
    const chat = stubChat()
    const t = setup(chat.client)
    const s = await skenario(t)
    const h = { headers: t.asAuditor(s.auditor.id), method: 'POST' }
    await t.call(`/assessments/${s.assessmentId}/ai-review`, h)
    await t.call(`/assessments/${s.assessmentId}/ai-review`, h)
    expect(chat.calls).toHaveLength(1)
    await t.call(`/assessments/${s.assessmentId}/ai-review?refresh=1`, h)
    expect(chat.calls).toHaveLength(2)
  })

  it('prompt memuat jawaban sebagai label manusia, bukan kode opsi', async () => {
    const chat = stubChat()
    const t = setup(chat.client)
    const s = await skenario(t)
    await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(chat.calls[0]).toContain('PT Tinjau')
    expect(chat.calls[0]).not.toMatch(/-> opt_\d+/)
  })

  it('assessment milik auditor lain dianggap tidak ada', async () => {
    const t = setup(stubChat().client)
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.lain.id),
    })
    expect(res.status).toBe(404)
  })

  it('menolak assessment yang belum dikirim, bukan menebak-nebak', async () => {
    const t = setup(stubChat().client)
    const s = await skenario(t, false)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(409)
  })

  it('melapor 503 jujur bila model belum dikonfigurasi', async () => {
    const t = setup()
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(503)
    expect((await res.json()).error.message).toContain('belum dikonfigurasi')
  })

  it('balasan model yang bukan JSON menjadi 503, bukan 500', async () => {
    const t = setup(stubChat(() => 'maaf saya tidak bisa membantu').client)
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(503)
  })

  it('GET mengembalikan 404 selama tinjauan belum pernah dijalankan', async () => {
    const t = setup(stubChat().client)
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/ai-review`, {
      headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(404)
  })
})

describe('FR-32 tinjauan massal', () => {
  it('meninjau antrean dan melewati yang sudah pernah ditinjau', async () => {
    const chat = stubChat()
    const t = setup(chat.client)
    const s = await skenario(t)
    const pertama = await (await t.call('/ai-review/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    expect(pertama.reviewed).toBe(1)

    const kedua = await (await t.call('/ai-review/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    expect(kedua.reviewed).toBe(0)
    expect(chat.calls).toHaveLength(1)
  })

  it('kegagalan satu perusahaan tidak membatalkan sisanya', async () => {
    let n = 0
    const t = setup(stubChat(() => (n++ === 0 ? 'bukan json' : BALASAN)).client)
    const s = await skenario(t)
    const res = await (await t.call('/ai-review/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    expect(res.items[0].status).toContain('failed')
    expect(res.reviewed).toBe(0)
  })

  it('hanya menyentuh perusahaan milik auditor pemanggil', async () => {
    const chat = stubChat()
    const t = setup(chat.client)
    const s = await skenario(t)
    const res = await (await t.call('/ai-review/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.lain.id) },
      body: JSON.stringify({}),
    })).json()
    expect(res.reviewed).toBe(0)
    expect(chat.calls).toHaveLength(0)
  })
})

describe('penyusunan masukan tinjauan', () => {
  it('menerjemahkan nilai jawaban menjadi teks yang dapat dibaca', () => {
    expect(answerText('APAPUN', { scale: 4 })).toBe('4 dari 5')
    expect(answerText('APAPUN', { bool: false })).toBe('Belum')
    expect(answerText('APAPUN', { choices: [] })).toContain('tidak memilih')
  })

  it('menyertakan seluruh jawaban dan skor dimensi', async () => {
    const t = setup(stubChat().client)
    const s = await skenario(t)
    const a = (await t.repo.getAssessment(s.assessmentId))!
    const input = buildReviewInput(a, {
      name: 'PT Tinjau', industry: 'retail_ecommerce', employee_band: '50_99',
    })
    expect(input.answers.length).toBeGreaterThan(10)
    expect(input.dimensions).toHaveLength(7)
  })
})
