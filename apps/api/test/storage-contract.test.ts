/**
 * Uji kontrak penyimpanan.
 *
 * Suite yang sama dijalankan terhadap implementasi memori DAN Postgres nyata,
 * sehingga keduanya dijamin berperilaku identik. Tanpa ini, mengganti
 * penyimpanan berisiko mengubah perilaku diam-diam.
 *
 * Postgres dilewati bila TEST_DATABASE_URL tidak disetel, agar pengembang tanpa
 * basis data tetap dapat menjalankan uji. Namun itu dilaporkan terang-terangan,
 * bukan dianggap lulus.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import type { AnswerValue } from '@siapai/scoring'
import { createMemoryRepo, type Repo } from '../src/lib/repo'
import { createDb, createPgRepo } from '../src/db/pg-repo'
import * as s from '../src/db/schema'

const PG_URL = process.env.TEST_DATABASE_URL

type Kasus = { nama: string; buat: () => Promise<Repo>; bersihkan?: () => Promise<void> }

const kasus: Kasus[] = [
  { nama: 'memori', buat: async () => createMemoryRepo() },
]

let tutupPg: (() => Promise<void>) | undefined
if (PG_URL) {
  const { db, client } = createDb(PG_URL, { max: 4 })
  tutupPg = () => client.end()
  kasus.push({
    nama: 'postgres',
    buat: async () => createPgRepo(db),
    bersihkan: async () => {
      // Urutan penting: anak lebih dulu, karena ada foreign key.
      await db.delete(s.answers)
      await db.delete(s.invitations)
      await db.delete(s.assessments)
      await db.delete(s.companies)
      await db.delete(s.auditors)
    },
  })
} else {
  // eslint-disable-next-line no-console
  console.warn('\n[LEWAT] Uji Postgres dilewati: TEST_DATABASE_URL tidak disetel.\n')
}

afterAll(async () => { await tutupPg?.() })

const contohAuditor = { email: 'a@x.id', name: 'Dimas', role: 'auditor' as const }
const contohCompany = (ownerId: string, name = 'PT Uji') => ({
  owner_auditor_id: ownerId, name,
  industry: 'retail_ecommerce' as const, employee_band: '50_99' as const,
  country: 'ID',
})

for (const k of kasus) {
  describe(`kontrak penyimpanan: ${k.nama}`, () => {
    let repo: Repo
    beforeEach(async () => {
      await k.bersihkan?.()
      repo = await k.buat()
    })

    it('menyimpan dan membaca auditor', async () => {
      const a = await repo.createAuditor(contohAuditor)
      expect(a.id).toBeTruthy()
      const lagi = await repo.getAuditor(a.id)
      expect(lagi?.email).toBe('a@x.id')
      expect(lagi?.name).toBe('Dimas')
      expect(lagi?.role).toBe('auditor')
    })

    it('kata sandi disimpan dan dibaca sebagai hash (FR-02)', async () => {
      const a = await repo.createAuditor({ ...contohAuditor, password_hash: 'scrypt$abc$def' })
      expect((await repo.getAuditorByEmail('a@x.id'))?.password_hash).toBe('scrypt$abc$def')

      // Menetapkan ulang menimpa nilai lama, bukan menambah baris baru.
      await repo.setAuditorPassword(a.id, 'scrypt$baru$hash')
      expect((await repo.getAuditor(a.id))?.password_hash).toBe('scrypt$baru$hash')
    })

    it('auditor tanpa kata sandi tidak mengarang nilai (FR-02)', async () => {
      const a = await repo.createAuditor(contohAuditor)
      expect((await repo.getAuditor(a.id))?.password_hash).toBeUndefined()
    })

    it('snapshot tinjauan AI bertahan pada assessment (FR-31)', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const c = await repo.createCompany(contohCompany(a.id))
      const as = await repo.createAssessment({
        id: crypto.randomUUID(), company_id: c.id, status: 'SCORED',
        questionnaire_version: '1.0.0', rubric_version: '1.0.0',
        started_at: new Date().toISOString(), submitted_at: new Date().toISOString(),
      })
      as.ai_review = {
        data_quality: 61, summary: 'ringkas',
        flags: [{ question_codes: ['DAT-01'], severity: 'high', issue: 'x', follow_up: 'y' }],
        next_checks: ['cek'], model: 'm', reviewed_at: '2026-01-01T00:00:00.000Z',
      }
      await repo.saveAssessment(as)

      const lagi = await repo.getAssessment(as.id)
      const r = lagi?.ai_review as { data_quality: number; flags: { severity: string }[] }
      expect(r.data_quality).toBe(61)
      expect(r.flags[0]!.severity).toBe('high')
    })

    it('assessment tanpa tinjauan AI tetap undefined, bukan null yang menyamar', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const c = await repo.createCompany(contohCompany(a.id))
      const as = await repo.createAssessment({
        id: crypto.randomUUID(), company_id: c.id, status: 'IN_PROGRESS',
        questionnaire_version: '1.0.0', rubric_version: '1.0.0',
        started_at: new Date().toISOString(), submitted_at: null,
      })
      expect((await repo.getAssessment(as.id))?.ai_review).toBeUndefined()
    })

    it('auditor yang tidak ada mengembalikan undefined', async () => {
      expect(await repo.getAuditor('00000000-0000-0000-0000-000000000000')).toBeUndefined()
    })

    it('perusahaan hanya terlihat oleh auditor pemiliknya (FR-06)', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const b = await repo.createAuditor({ ...contohAuditor, email: 'b@x.id', name: 'Other' })
      const c = await repo.createCompany(contohCompany(a.id))

      expect((await repo.getCompany(c.id, a.id))?.name).toBe('PT Uji')
      expect(await repo.getCompany(c.id, b.id)).toBeUndefined()
      expect(await repo.listCompanies(b.id)).toHaveLength(0)
      expect(await repo.listCompanies(a.id)).toHaveLength(1)
    })

    it('menyimpan seluruh field perusahaan termasuk yang opsional', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const c = await repo.createCompany({
        ...contohCompany(a.id), revenue_band: '15b_50b', province: 'Jawa Barat',
      })
      const lagi = await repo.getCompany(c.id, a.id)
      expect(lagi?.revenue_band).toBe('15b_50b')
      expect(lagi?.province).toBe('Jawa Barat')
      expect(lagi?.country).toBe('ID')
      expect(lagi?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('assessment menyimpan versi kuesioner dan rubrik (PA5)', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const c = await repo.createCompany(contohCompany(a.id))
      const as = await repo.createAssessment({
        id: crypto.randomUUID(), company_id: c.id, status: 'IN_PROGRESS',
        questionnaire_version: '1.0.0', rubric_version: '1.0.0',
        started_at: new Date().toISOString(), submitted_at: null,
      })
      const lagi = await repo.getAssessment(as.id)
      expect(lagi?.questionnaire_version).toBe('1.0.0')
      expect(lagi?.rubric_version).toBe('1.0.0')
      expect(lagi?.status).toBe('IN_PROGRESS')
      expect(lagi?.server_revision).toBe(0)
      expect(lagi?.answers.size).toBe(0)
    })

    it('jawaban bertahan lintas pembacaan dan bersifat idempoten', async () => {
      const { assessmentId } = await siapkan(repo)
      const a1 = (await repo.getAssessment(assessmentId))!
      a1.answers.set('DAT-01', {
        question_code: 'DAT-01', value: { choice: 'opt_75' },
        answered_at: new Date().toISOString(),
      })
      a1.server_revision = 1
      await repo.saveAssessment(a1)

      const a2 = (await repo.getAssessment(assessmentId))!
      expect(a2.answers.size).toBe(1)
      expect(a2.answers.get('DAT-01')!.value).toEqual({ choice: 'opt_75' })
      expect(a2.server_revision).toBe(1)

      // Menyimpan ulang kode yang sama menimpa, bukan menggandakan.
      a2.answers.set('DAT-01', {
        question_code: 'DAT-01', value: { choice: 'opt_25' },
        answered_at: new Date().toISOString(),
      })
      await repo.saveAssessment(a2)
      const a3 = (await repo.getAssessment(assessmentId))!
      expect(a3.answers.size).toBe(1)
      expect(a3.answers.get('DAT-01')!.value).toEqual({ choice: 'opt_25' })
    })

    it('jawaban yang dihapus dari state ikut hilang di penyimpanan', async () => {
      const { assessmentId } = await siapkan(repo)
      const a1 = (await repo.getAssessment(assessmentId))!
      for (const kode of ['DAT-01', 'DAT-02', 'STR-01']) {
        a1.answers.set(kode, {
          question_code: kode, value: { choice: 'opt_50' },
          answered_at: new Date().toISOString(),
        })
      }
      await repo.saveAssessment(a1)

      const a2 = (await repo.getAssessment(assessmentId))!
      expect(a2.answers.size).toBe(3)
      a2.answers.delete('STR-01') // meniru pertanyaan yang tersembunyi karena branching
      await repo.saveAssessment(a2)

      const a3 = (await repo.getAssessment(assessmentId))!
      expect(a3.answers.size).toBe(2)
      expect(a3.answers.has('STR-01')).toBe(false)
    })

    it('menyimpan berbagai bentuk nilai jawaban tanpa kehilangan bentuknya', async () => {
      const { assessmentId } = await siapkan(repo)
      const a = (await repo.getAssessment(assessmentId))!
      const bentuk: [string, AnswerValue][] = [
        ['DAT-01', { choice: 'opt_75' }],
        ['DAT-07', { choices: ['sales_tx', 'customer'] }],
        ['STR-06', { scale: 4 }],
        ['TEC-06', { bool: true }],
      ]
      for (const [kode, nilai] of bentuk) {
        a.answers.set(kode, {
          question_code: kode, value: nilai, answered_at: new Date().toISOString(),
        })
      }
      await repo.saveAssessment(a)

      const lagi = (await repo.getAssessment(assessmentId))!
      for (const [kode, nilai] of bentuk) {
        expect(lagi.answers.get(kode)!.value).toEqual(nilai)
      }
    })

    it('menyimpan evidence_url bila ada, dan mengabaikannya bila tidak', async () => {
      const { assessmentId } = await siapkan(repo)
      const a = (await repo.getAssessment(assessmentId))!
      a.answers.set('DAT-01', {
        question_code: 'DAT-01', value: { choice: 'opt_75' },
        evidence_url: 'https://x.id/bukti.pdf', answered_at: new Date().toISOString(),
      })
      a.answers.set('DAT-02', {
        question_code: 'DAT-02', value: { choice: 'opt_50' },
        answered_at: new Date().toISOString(),
      })
      await repo.saveAssessment(a)

      const lagi = (await repo.getAssessment(assessmentId))!
      expect(lagi.answers.get('DAT-01')!.evidence_url).toBe('https://x.id/bukti.pdf')
      expect(lagi.answers.get('DAT-02')!.evidence_url).toBeUndefined()
    })

    it('snapshot hasil skoring bertahan utuh (ADR-004)', async () => {
      const { assessmentId } = await siapkan(repo)
      const a = (await repo.getAssessment(assessmentId))!
      const snapshot = {
        total_score: 58.4, level: 3, verdict: 'CONDITIONALLY_READY',
        dimensions: [{ dimension_code: 'DAT', score: 36 }],
        gates: [{ code: 'DATA_FOUNDATION_GATE', triggered: true }],
      }
      a.status = 'SCORED'
      a.submitted_at = new Date().toISOString()
      a.score_snapshot = snapshot
      await repo.saveAssessment(a)

      const lagi = (await repo.getAssessment(assessmentId))!
      expect(lagi.status).toBe('SCORED')
      expect(lagi.submitted_at).toBeTruthy()
      expect(lagi.score_snapshot).toEqual(snapshot)
    })

    it('undangan dapat ditemukan lewat hash token', async () => {
      const { companyId, assessmentId } = await siapkan(repo)
      const inv = await buatUndangan(repo, companyId, assessmentId, 'hash-abc')
      const lagi = await repo.findByTokenHash('hash-abc')
      expect(lagi?.id).toBe(inv.id)
      expect(await repo.findByTokenHash('hash-yang-salah')).toBeUndefined()
    })

    it('hanya satu undangan aktif per perusahaan yang ditemukan', async () => {
      const { companyId, assessmentId } = await siapkan(repo)
      expect(await repo.findActiveByCompany(companyId)).toBeUndefined()

      const inv = await buatUndangan(repo, companyId, assessmentId, 'hash-1')
      expect((await repo.findActiveByCompany(companyId))?.id).toBe(inv.id)

      // Setelah dicabut, tidak lagi dianggap aktif.
      inv.status = 'REVOKED'
      inv.revoked_at = new Date().toISOString()
      await repo.saveInvitation(inv)
      expect(await repo.findActiveByCompany(companyId)).toBeUndefined()
    })

    it('perubahan status undangan bertahan', async () => {
      const { companyId, assessmentId } = await siapkan(repo)
      const inv = await buatUndangan(repo, companyId, assessmentId, 'hash-2')
      inv.status = 'OPENED'
      inv.opened_at = new Date().toISOString()
      inv.reminder_count = 2
      await repo.saveInvitation(inv)

      const lagi = await repo.getInvitation(inv.id)
      expect(lagi?.status).toBe('OPENED')
      expect(lagi?.opened_at).toBeTruthy()
      expect(lagi?.reminder_count).toBe(2)
    })

    it('daftar undangan ber-scope auditor pemilik', async () => {
      const a = await repo.createAuditor(contohAuditor)
      const b = await repo.createAuditor({ ...contohAuditor, email: 'b@x.id', name: 'Other' })
      const ca = await repo.createCompany(contohCompany(a.id, 'Punya A'))
      const asA = await repo.createAssessment({
        id: crypto.randomUUID(), company_id: ca.id, status: 'IN_PROGRESS',
        questionnaire_version: '1.0.0', rubric_version: '1.0.0',
        started_at: new Date().toISOString(), submitted_at: null,
      })
      await buatUndangan(repo, ca.id, asA.id, 'hash-a')

      expect(await repo.listInvitations(a.id)).toHaveLength(1)
      expect(await repo.listInvitations(b.id)).toHaveLength(0)
    })

    it('token yang disegel bertahan apa adanya', async () => {
      const { companyId, assessmentId } = await siapkan(repo)
      const inv = await buatUndangan(repo, companyId, assessmentId, 'hash-3')
      const lagi = await repo.getInvitation(inv.id)
      expect(lagi?.token_sealed).toBe(inv.token_sealed)
      expect(lagi?.token_hash).toBe('hash-3')
    })

    it('getCompanyOfInvitation mengembalikan perusahaan yang benar', async () => {
      const { companyId, assessmentId } = await siapkan(repo)
      const inv = await buatUndangan(repo, companyId, assessmentId, 'hash-4')
      const c = await repo.getCompanyOfInvitation(inv)
      expect(c?.id).toBe(companyId)
    })
  })
}

async function siapkan(repo: Repo) {
  const a = await repo.createAuditor({ email: `u${Math.random()}@x.id`, name: 'Dimas', role: 'auditor' })
  const c = await repo.createCompany(contohCompany(a.id))
  const as = await repo.createAssessment({
    id: crypto.randomUUID(), company_id: c.id, status: 'IN_PROGRESS',
    questionnaire_version: '1.0.0', rubric_version: '1.0.0',
    started_at: new Date().toISOString(), submitted_at: null,
  })
  return { auditorId: a.id, companyId: c.id, assessmentId: as.id }
}

async function buatUndangan(repo: Repo, companyId: string, assessmentId: string, hash: string) {
  return repo.createInvitation({
    id: crypto.randomUUID(),
    company_id: companyId,
    assessment_id: assessmentId,
    token_hash: hash,
    token_sealed: `sealed:${hash}`,
    status: 'SENT',
    recipient_name: 'Pak Budi',
    issued_at: new Date().toISOString(),
    opened_at: null,
    submitted_at: null,
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    revoked_at: null,
    reminder_count: 0,
  })
}
