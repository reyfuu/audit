/**
 * Repository Postgres (ADR-008).
 *
 * Mengimplementasikan antarmuka `Repo` yang sama dengan versi in-memory,
 * sehingga modul HTTP tidak berubah sama sekali. Semua query ber-scope
 * perusahaan menegakkan kepemilikan di klausa WHERE, bukan hanya di guard.
 *
 * Antarmuka `Repo` dibuat asinkron sejak awal supaya penyimpanan yang benar-benar
 * melakukan I/O dapat dipasang tanpa mengubah modul HTTP.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Answer } from '@siapai/scoring'
import * as s from './schema'
import type {
  AssessmentRow, AuditorRow, CompanyRow, InvitationRow, Repo,
} from '../lib/repo'

export type Db = PostgresJsDatabase<typeof s>

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10 })
  return { db: drizzle(client, { schema: s }) as Db, client }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

type CompanySelect = typeof s.companies.$inferSelect
type AssessmentSelect = typeof s.assessments.$inferSelect
type AnswerSelect = typeof s.answers.$inferSelect
type InvitationSelect = typeof s.invitations.$inferSelect

function toCompany(r: CompanySelect): CompanyRow {
  return {
    id: r.id,
    owner_auditor_id: r.ownerAuditorId,
    name: r.name,
    industry: r.industry,
    employee_band: r.employeeBand,
    ...(r.revenueBand ? { revenue_band: r.revenueBand } : {}),
    country: r.country,
    ...(r.province ? { province: r.province } : {}),
    created_at: r.createdAt.toISOString(),
  }
}

function toAssessment(r: AssessmentSelect, rows: AnswerSelect[]): AssessmentRow {
  const answers = new Map<string, Answer & { answered_at: string }>()
  for (const a of rows) {
    answers.set(a.questionCode, {
      question_code: a.questionCode,
      value: a.value as Answer['value'],
      ...(a.evidenceUrl ? { evidence_url: a.evidenceUrl } : {}),
      answered_at: a.answeredAt.toISOString(),
    })
  }
  return {
    id: r.id,
    company_id: r.companyId,
    status: r.status,
    questionnaire_version: r.questionnaireVersion,
    rubric_version: r.rubricVersion,
    started_at: r.startedAt.toISOString(),
    submitted_at: iso(r.submittedAt),
    server_revision: r.serverRevision,
    answers,
    ...(r.scoreSnapshot ? { score_snapshot: r.scoreSnapshot } : {}),
  }
}

function toInvitation(r: InvitationSelect): InvitationRow {
  return {
    id: r.id,
    company_id: r.companyId,
    assessment_id: r.assessmentId,
    token_hash: r.tokenHash,
    token_sealed: r.tokenSealed,
    status: r.status,
    ...(r.recipientName ? { recipient_name: r.recipientName } : {}),
    ...(r.recipientEmail ? { recipient_email: r.recipientEmail } : {}),
    issued_at: r.issuedAt.toISOString(),
    opened_at: iso(r.openedAt),
    submitted_at: iso(r.submittedAt),
    expires_at: r.expiresAt.toISOString(),
    revoked_at: iso(r.revokedAt),
    reminder_count: r.reminderCount,
  }
}

/** Status yang masih memungkinkan responden mengisi form. */
const AKTIF = ['SENT', 'OPENED', 'IN_PROGRESS'] as const

export function createPgRepo(db: Db): Repo {
  async function loadAssessment(id: string): Promise<AssessmentRow | undefined> {
    const [row] = await db.select().from(s.assessments).where(eq(s.assessments.id, id))
    if (!row) return undefined
    const rows = await db.select().from(s.answers).where(eq(s.answers.assessmentId, id))
    return toAssessment(row, rows)
  }

  return {
    async createAuditor(input) {
      const [r] = await db.insert(s.auditors)
        .values({ email: input.email, name: input.name, role: input.role })
        .returning()
      return { id: r!.id, email: r!.email, name: r!.name, role: r!.role }
    },

    async getAuditor(id) {
      const [r] = await db.select().from(s.auditors).where(eq(s.auditors.id, id))
      return r ? { id: r.id, email: r.email, name: r.name, role: r.role } : undefined
    },

    async createCompany(input) {
      const [r] = await db.insert(s.companies).values({
        ownerAuditorId: input.owner_auditor_id,
        name: input.name,
        industry: input.industry,
        employeeBand: input.employee_band,
        revenueBand: input.revenue_band ?? null,
        country: input.country,
        province: input.province ?? null,
      }).returning()
      return toCompany(r!)
    },

    async getCompany(id, auditorId) {
      // Kepemilikan ditegakkan di query, bukan diperiksa setelahnya.
      const [r] = await db.select().from(s.companies)
        .where(and(eq(s.companies.id, id), eq(s.companies.ownerAuditorId, auditorId)))
      return r ? toCompany(r) : undefined
    },

    async getCompanyOfInvitation(inv) {
      const [r] = await db.select().from(s.companies).where(eq(s.companies.id, inv.company_id))
      return r ? toCompany(r) : undefined
    },

    async listCompanies(auditorId) {
      const rows = await db.select().from(s.companies)
        .where(eq(s.companies.ownerAuditorId, auditorId))
        .orderBy(desc(s.companies.createdAt))
      return rows.map(toCompany)
    },

    async createAssessment(input) {
      const [r] = await db.insert(s.assessments).values({
        id: input.id,
        companyId: input.company_id,
        status: input.status,
        questionnaireVersion: input.questionnaire_version,
        rubricVersion: input.rubric_version,
        startedAt: new Date(input.started_at),
        submittedAt: input.submitted_at ? new Date(input.submitted_at) : null,
      }).returning()
      return toAssessment(r!, [])
    },

    getAssessment: loadAssessment,

    async saveAssessment(row) {
      await db.transaction(async (tx) => {
        await tx.update(s.assessments).set({
          status: row.status,
          submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
          serverRevision: row.server_revision,
          scoreSnapshot: row.score_snapshot ?? null,
        }).where(eq(s.assessments.id, row.id))

        const kode = [...row.answers.keys()]
        // Buang jawaban yang hilang dari state (mis. karena branching menutupinya).
        if (kode.length === 0) {
          await tx.delete(s.answers).where(eq(s.answers.assessmentId, row.id))
        } else {
          const ada = await tx.select({ c: s.answers.questionCode }).from(s.answers)
            .where(eq(s.answers.assessmentId, row.id))
          const hilang = ada.map((x) => x.c).filter((c) => !row.answers.has(c))
          if (hilang.length) {
            await tx.delete(s.answers).where(and(
              eq(s.answers.assessmentId, row.id),
              inArray(s.answers.questionCode, hilang),
            ))
          }
          // Upsert massal; indeks unik (assessment, question) menjamin idempotensi.
          await tx.insert(s.answers).values(
            [...row.answers.values()].map((a) => ({
              assessmentId: row.id,
              questionCode: a.question_code,
              value: a.value,
              evidenceUrl: a.evidence_url ?? null,
              answeredAt: new Date(a.answered_at),
            })),
          ).onConflictDoUpdate({
            target: [s.answers.assessmentId, s.answers.questionCode],
            set: {
              value: sqlExcluded('value'),
              evidenceUrl: sqlExcluded('evidence_url'),
              answeredAt: sqlExcluded('answered_at'),
            },
          })
        }
      })
    },

    async createInvitation(input) {
      const [r] = await db.insert(s.invitations).values({
        id: input.id,
        companyId: input.company_id,
        assessmentId: input.assessment_id,
        tokenHash: input.token_hash,
        tokenSealed: input.token_sealed,
        status: input.status,
        recipientName: input.recipient_name ?? null,
        recipientEmail: input.recipient_email ?? null,
        issuedAt: new Date(input.issued_at),
        openedAt: input.opened_at ? new Date(input.opened_at) : null,
        submittedAt: input.submitted_at ? new Date(input.submitted_at) : null,
        expiresAt: new Date(input.expires_at),
        revokedAt: input.revoked_at ? new Date(input.revoked_at) : null,
        reminderCount: input.reminder_count,
      }).returning()
      return toInvitation(r!)
    },

    async getInvitation(id) {
      const [r] = await db.select().from(s.invitations).where(eq(s.invitations.id, id))
      return r ? toInvitation(r) : undefined
    },

    async findByTokenHash(hash) {
      const [r] = await db.select().from(s.invitations).where(eq(s.invitations.tokenHash, hash))
      return r ? toInvitation(r) : undefined
    },

    async findActiveByCompany(companyId) {
      const [r] = await db.select().from(s.invitations)
        .where(and(
          eq(s.invitations.companyId, companyId),
          inArray(s.invitations.status, [...AKTIF]),
        ))
        .orderBy(desc(s.invitations.issuedAt))
      return r ? toInvitation(r) : undefined
    },

    async listInvitations(auditorId) {
      const rows = await db.select({ inv: s.invitations })
        .from(s.invitations)
        .innerJoin(s.companies, eq(s.invitations.companyId, s.companies.id))
        .where(eq(s.companies.ownerAuditorId, auditorId))
        .orderBy(desc(s.invitations.issuedAt))
      return rows.map((r) => toInvitation(r.inv))
    },

    async saveInvitation(row) {
      await db.update(s.invitations).set({
        status: row.status,
        openedAt: row.opened_at ? new Date(row.opened_at) : null,
        submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
        reminderCount: row.reminder_count,
        tokenHash: row.token_hash,
        tokenSealed: row.token_sealed,
      }).where(eq(s.invitations.id, row.id))
    },
  }
}

/** Referensi ke baris yang bentrok pada klausa ON CONFLICT DO UPDATE. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`)
}
