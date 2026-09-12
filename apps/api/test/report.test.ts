import '../test/setup-dev-tokens'
/**
 * Uji tautan bagikan dan ekspor PDF (FR-17, FR-18).
 */
import { describe, expect, it } from 'bun:test'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../src/app'
import { createMemoryRepo } from '../src/lib/repo'

const BASE = 'http://localhost:3001'

function setup(opts: {
  now?: () => Date
  renderPdf?: (url: string) => Promise<ArrayBuffer>
} = {}) {
  const repo = createMemoryRepo()
  const { app } = createApp({
    repo, baseUrl: BASE,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.renderPdf ? { renderPdf: opts.renderPdf } : {}),
  })
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

/** Menyiapkan satu assessment yang sudah diskor beserta auditornya. */
async function skenario(t: ReturnType<typeof setup>, namaPerusahaan = 'PT Laporan') {
  const auditor = await t.repo.createAuditor({ email: 'a@x.id', name: 'Dimas', role: 'auditor' })
  const lain = await t.repo.createAuditor({ email: 'b@x.id', name: 'Other', role: 'auditor' })
  const company = await t.repo.createCompany({
    owner_auditor_id: auditor.id, name: namaPerusahaan,
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
  await t.call(`/f/${inv.token}/submit`, { method: 'POST' })
  return { auditor, lain, company, assessmentId: inv.assessment_id }
}

describe('FR-18 tautan bagikan', () => {
  it('auditor dapat membuat tautan read-only', async () => {
    const t = setup()
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(201)
    const link = await res.json()
    expect(link.url).toMatch(/\/l\/[A-Za-z0-9_-]{20,}/)
    expect(link.anonymize).toBe(false)
    expect(link.view_count).toBe(0)
  })

  it('tautan membuka laporan tanpa perlu akun', async () => {
    const t = setup()
    const s = await skenario(t, 'PT Terbuka')
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()

    const path = new URL(link.url).pathname
    const res = await t.call(path) // tanpa header authorization
    expect(res.status).toBe(200)
    const laporan = await res.json()
    expect(laporan.company_name).toBe('PT Terbuka')
    expect(laporan.result.total_score).toBeGreaterThan(90)
    expect(laporan.recommendations.items.length).toBeGreaterThanOrEqual(3)
  })

  it('opsi anonymize menyembunyikan nama perusahaan', async () => {
    const t = setup()
    const s = await skenario(t, 'PT Rahasia')
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({ anonymize: true }),
    })).json()
    const laporan = await (await t.call(new URL(link.url).pathname)).json()
    expect(laporan.company_name).toBeNull()
    // Skor tetap lengkap; yang disembunyikan hanya identitasnya.
    expect(laporan.result.dimensions).toHaveLength(7)
  })

  it('jumlah dilihat bertambah setiap kali dibuka', async () => {
    const t = setup()
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    const path = new URL(link.url).pathname
    await t.call(path)
    await t.call(path)
    const daftar = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      headers: t.asAuditor(s.auditor.id),
    })).json()
    expect(daftar.items[0].view_count).toBe(2)
  })

  it('tautan yang dicabut langsung berhenti berlaku', async () => {
    const t = setup()
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    const path = new URL(link.url).pathname
    expect((await t.call(path)).status).toBe(200)

    const del = await t.call(`/share-links/${link.id}`, {
      method: 'DELETE', headers: t.asAuditor(s.auditor.id),
    })
    expect(del.status).toBe(204)
    expect((await t.call(path)).status).toBe(404)
  })

  it('tautan kedaluwarsa setelah masa berlakunya lewat', async () => {
    let sekarang = new Date('2026-01-01T00:00:00Z')
    const t = setup({ now: () => sekarang })
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({ expires_in_days: 7 }),
    })).json()
    const path = new URL(link.url).pathname
    expect((await t.call(path)).status).toBe(200)

    sekarang = new Date('2026-01-09T00:00:00Z')
    expect((await t.call(path)).status).toBe(404)
  })

  it('token palsu ditolak', async () => {
    const t = setup()
    expect((await t.call('/l/token-yang-tidak-pernah-ada')).status).toBe(404)
  })

  it('auditor lain tidak dapat membuat tautan untuk assessment bukan miliknya', async () => {
    const t = setup()
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.lain.id) },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404) // bukan 403: keberadaannya tidak dibocorkan
  })

  it('auditor lain tidak dapat mencabut tautan milik orang lain', async () => {
    const t = setup()
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    const res = await t.call(`/share-links/${link.id}`, {
      method: 'DELETE', headers: t.asAuditor(s.lain.id),
    })
    expect(res.status).toBe(404)
    // Tautan tetap hidup setelah percobaan gagal.
    expect((await t.call(new URL(link.url).pathname)).status).toBe(200)
  })

  it('tanpa autentikasi tidak dapat membuat tautan', async () => {
    const t = setup()
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('token tidak disimpan polos', async () => {
    const t = setup()
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    const token = new URL(link.url).pathname.split('/l/')[1]!
    const rows = await t.repo.listShareLinks(s.assessmentId)
    expect(rows[0]!.token_hash).not.toBe(token)
    expect(rows[0]!.token_sealed).not.toContain(token)
  })

  it('daftar tautan menyembunyikan URL yang sudah dicabut', async () => {
    const t = setup()
    const s = await skenario(t)
    const link = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(s.auditor.id) },
      body: JSON.stringify({}),
    })).json()
    await t.call(`/share-links/${link.id}`, { method: 'DELETE', headers: t.asAuditor(s.auditor.id) })
    const daftar = await (await t.call(`/assessments/${s.assessmentId}/share-links`, {
      headers: t.asAuditor(s.auditor.id),
    })).json()
    expect(daftar.items[0].revoked).toBe(true)
    expect(daftar.items[0].url).toBeNull()
  })
})

describe('FR-17 ekspor PDF', () => {
  it('menghasilkan PDF dengan nama berkas yang bermakna', async () => {
    let urlYangDirender = ''
    const t = setup({
      renderPdf: async (url) => {
        urlYangDirender = url
        return new TextEncoder().encode('%PDF-1.7 palsu').buffer as ArrayBuffer
      },
    })
    const s = await skenario(t, 'PT Maju Jaya')
    const res = await t.call(`/assessments/${s.assessmentId}/report/pdf`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('laporan-kesiapan-ai-pt-maju-jaya.pdf')
    // ADR-005: yang dirender adalah halaman laporan yang sama.
    expect(urlYangDirender).toMatch(/\/l\/[A-Za-z0-9_-]{20,}/)
  })

  it('tautan sementara untuk render langsung dicabut setelah selesai', async () => {
    let urlYangDirender = ''
    const t = setup({
      renderPdf: async (url) => {
        urlYangDirender = url
        return new ArrayBuffer(8)
      },
    })
    const s = await skenario(t)
    await t.call(`/assessments/${s.assessmentId}/report/pdf`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    // Tautan internal tidak boleh tetap hidup setelah dipakai.
    const path = new URL(urlYangDirender).pathname
    expect((await t.call(path)).status).toBe(404)
  })

  it('tautan sementara tetap dicabut walau render gagal', async () => {
    let urlYangDirender = ''
    const t = setup({
      renderPdf: async (url) => {
        urlYangDirender = url
        throw new Error('browser mati')
      },
    })
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/report/pdf`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(500)
    expect((await t.call(new URL(urlYangDirender).pathname)).status).toBe(404)
  })

  it('melapor jujur 503 bila perender tidak tersedia', async () => {
    const t = setup() // tanpa renderPdf
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/report/pdf`, {
      method: 'POST', headers: t.asAuditor(s.auditor.id),
    })
    expect(res.status).toBe(503)
  })

  it('auditor lain tidak dapat mengunduh PDF milik orang lain', async () => {
    const t = setup({ renderPdf: async () => new ArrayBuffer(8) })
    const s = await skenario(t)
    const res = await t.call(`/assessments/${s.assessmentId}/report/pdf`, {
      method: 'POST', headers: t.asAuditor(s.lain.id),
    })
    expect(res.status).toBe(404)
  })

  it('tanpa autentikasi ditolak', async () => {
    const t = setup({ renderPdf: async () => new ArrayBuffer(8) })
    const s = await skenario(t)
    expect((await t.call(`/assessments/${s.assessmentId}/report/pdf`, { method: 'POST' })).status)
      .toBe(401)
  })
})

describe('laporan belum siap', () => {
  it('tidak dapat dibagikan sebelum assessment diskor', async () => {
    const t = setup()
    const auditor = await t.repo.createAuditor({ email: 'c@x.id', name: 'D', role: 'auditor' })
    const company = await t.repo.createCompany({
      owner_auditor_id: auditor.id, name: 'PT Belum', industry: 'fnb',
      employee_band: '10_49', country: 'ID',
    })
    const inv = await (await t.call('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(auditor.id) },
      body: JSON.stringify({ company_id: company.id }),
    })).json() as { assessment_id: string }

    const res = await t.call(`/assessments/${inv.assessment_id}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.asAuditor(auditor.id) },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
  })
})
