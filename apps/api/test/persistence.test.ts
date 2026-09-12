import '../test/setup-dev-tokens'
/**
 * Bukti persistensi lintas restart.
 *
 * Uji kontrak penyimpanan memakai satu koneksi, sehingga tidak membuktikan data
 * bertahan setelah proses mati. Di sini setiap tahap memakai koneksi baru,
 * meniru aplikasi yang dimatikan lalu dijalankan lagi. Inilah yang benar-benar
 * penting: jawaban owner tidak boleh hilang saat server di-restart.
 *
 * Dilewati bila TEST_DATABASE_URL tidak disetel.
 */
import { describe, expect, it } from 'bun:test'
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../src/app'
import { createDb, createPgRepo } from '../src/db/pg-repo'
import * as s from '../src/db/schema'

const PG_URL = process.env.TEST_DATABASE_URL
const BASE = 'http://localhost:3001'

/** Menjalankan satu "sesi server": koneksi dibuka, dipakai, lalu ditutup. */
async function sesi<T>(fn: (ctx: {
  app: ReturnType<typeof createApp>['app']
  repo: ReturnType<typeof createPgRepo>
}) => Promise<T>): Promise<T> {
  const { db, client } = createDb(PG_URL!, { max: 2 })
  const repo = createPgRepo(db)
  const { app } = createApp({ repo, baseUrl: BASE })
  try {
    return await fn({ app, repo })
  } finally {
    await client.end()
  }
}

async function bersihkan() {
  const { db, client } = createDb(PG_URL!, { max: 1 })
  await db.delete(s.answers)
  await db.delete(s.invitations)
  await db.delete(s.assessments)
  await db.delete(s.companies)
  await db.delete(s.auditors)
  await client.end()
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

if (!PG_URL) {
  describe.skip('persistensi lintas restart (perlu TEST_DATABASE_URL)', () => {
    it('dilewati', () => {})
  })
} else {
  describe('persistensi lintas restart', () => {
    it('jawaban owner bertahan setelah server dimatikan dan dijalankan ulang', async () => {
      await bersihkan()

      // ── Sesi 1: auditor menerbitkan undangan, owner mengisi sebagian
      const { token, invId } = await sesi(async ({ app, repo }) => {
        const auditor = await repo.createAuditor({
          email: 'p@x.id', name: 'Dimas', role: 'auditor',
        })
        const company = await repo.createCompany({
          owner_auditor_id: auditor.id, name: 'PT Tahan Restart',
          industry: 'manufacturing', employee_band: '100_499', country: 'ID',
        })
        const res = await app.handle(new Request(`${BASE}/invitations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer user:${auditor.id}` },
          body: JSON.stringify({ company_id: company.id, recipient_name: 'Pak Budi' }),
        }))
        const inv = await res.json() as { id: string; token: string }

        // Owner menjawab beberapa pertanyaan lalu menutup browsernya.
        await app.handle(new Request(`${BASE}/f/${inv.token}/answers`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            answers: [
              { question_code: 'ORG-02', value: { choice: '100_499' } },
              { question_code: 'DAT-01', value: { choice: 'opt_75' } },
              { question_code: 'DAT-02', value: { choice: 'opt_100' } },
            ],
          }),
        }))
        return { token: inv.token, invId: inv.id }
      })

      // ── Sesi 2: proses baru, koneksi baru. Jawaban harus masih ada.
      await sesi(async ({ app }) => {
        const welcome = await (await app.handle(new Request(`${BASE}/f/${token}`))).json()
        expect(welcome.company_name).toBe('PT Tahan Restart')
        expect(welcome.resume).toBe(true)
        expect(welcome.progress.answered).toBe(3)

        const review = await (await app.handle(new Request(`${BASE}/f/${token}/review`))).json()
        const dat01 = review.answers.find((a: { question_code: string }) => a.question_code === 'DAT-01')
        expect(dat01.value).toEqual({ choice: 'opt_75' })
      })

      // ── Sesi 3: owner menyelesaikan dan mengirim
      const skor = await sesi(async ({ app }) => {
        for (let i = 0; i < 60; i++) {
          const s = await (await app.handle(new Request(`${BASE}/f/${token}/next`))).json()
          const sudah = new Set(s.answers.map((a: { question_code: string }) => a.question_code))
          const kurang = (s.questions as Question[]).filter((q) => !sudah.has(q.code))
          if (kurang.length === 0) {
            const rev = await (await app.handle(new Request(`${BASE}/f/${token}/review`))).json()
            if (rev.missing.length === 0) break
            const kode = rev.missing[0] as string
            const dim = QN.questions.find((q) => q.code === kode)!.dimension_code
            const sec = await (await app.handle(new Request(`${BASE}/f/${token}/next?section=${dim}`))).json()
            await app.handle(new Request(`${BASE}/f/${token}/answers`, {
              method: 'PATCH', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                answers: (sec.questions as Question[])
                  .filter((q) => rev.missing.includes(q.code))
                  .map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
              }),
            }))
            continue
          }
          await app.handle(new Request(`${BASE}/f/${token}/answers`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              answers: kurang.map((q) => ({ question_code: q.code, value: nilaiTertinggi(q) })),
            }),
          }))
        }
        const res = await app.handle(new Request(`${BASE}/f/${token}/submit`, { method: 'POST' }))
        expect(res.status).toBe(200)
        return await res.json() as { total_score: number; verdict: string }
      })

      expect(skor.total_score).toBeGreaterThan(90)

      // ── Sesi 4: laporan tetap dapat dibuka, dan angkanya identik
      await sesi(async ({ app }) => {
        const hasil = await (await app.handle(new Request(`${BASE}/f/${token}/result`))).json()
        expect(hasil.result.total_score).toBe(skor.total_score)
        expect(hasil.result.verdict).toBe(skor.verdict)
        expect(hasil.recommendations.items.length).toBeGreaterThanOrEqual(3)
      })

      // ── Sesi 5: dashboard auditor melihat status akhir
      await sesi(async ({ app, repo }) => {
        const inv = await repo.getInvitation(invId)
        expect(inv?.status).toBe('SCORED')
        const c = await repo.getCompanyOfInvitation(inv!)
        const daftar = await (await app.handle(new Request(`${BASE}/invitations`, {
          headers: { authorization: `Bearer user:${c!.owner_auditor_id}` },
        }))).json()
        expect(daftar.items).toHaveLength(1)
        expect(daftar.items[0].status).toBe('SCORED')
        expect(daftar.items[0].progress.percent).toBe(100)
      })
    })

    it('undangan yang dicabut tetap tercabut setelah restart', async () => {
      await bersihkan()
      const { token, invId, auditorId } = await sesi(async ({ app, repo }) => {
        const a = await repo.createAuditor({ email: 'r@x.id', name: 'D', role: 'auditor' })
        const c = await repo.createCompany({
          owner_auditor_id: a.id, name: 'PT Cabut', industry: 'fnb',
          employee_band: '10_49', country: 'ID',
        })
        const inv = await (await app.handle(new Request(`${BASE}/invitations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer user:${a.id}` },
          body: JSON.stringify({ company_id: c.id }),
        }))).json() as { id: string; token: string }

        await app.handle(new Request(`${BASE}/invitations/${inv.id}`, {
          method: 'DELETE', headers: { authorization: `Bearer user:${a.id}` },
        }))
        return { token: inv.token, invId: inv.id, auditorId: a.id }
      })

      await sesi(async ({ app, repo }) => {
        expect((await app.handle(new Request(`${BASE}/f/${token}`))).status).toBe(404)
        expect((await repo.getInvitation(invId))?.status).toBe('REVOKED')
        expect(auditorId).toBeTruthy()
      })
    })

    it('isolasi antar auditor tetap berlaku di penyimpanan nyata', async () => {
      await bersihkan()
      const ids = await sesi(async ({ repo }) => {
        const a = await repo.createAuditor({ email: 'x@x.id', name: 'A', role: 'auditor' })
        const b = await repo.createAuditor({ email: 'y@x.id', name: 'B', role: 'auditor' })
        const c = await repo.createCompany({
          owner_auditor_id: a.id, name: 'PT Milik A', industry: 'technology',
          employee_band: '10_49', country: 'ID',
        })
        return { a: a.id, b: b.id, c: c.id }
      })

      await sesi(async ({ repo }) => {
        expect(await repo.getCompany(ids.c, ids.a)).toBeDefined()
        expect(await repo.getCompany(ids.c, ids.b)).toBeUndefined()
        expect(await repo.listCompanies(ids.b)).toHaveLength(0)
      })
    })
  })
}
