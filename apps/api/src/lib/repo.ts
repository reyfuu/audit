/**
 * Repository in-memory.
 *
 * Disembunyikan di balik antarmuka `Repo` agar penggantian ke Drizzle/Postgres
 * (ADR-008) tidak menyentuh modul HTTP. Query ber-scope perusahaan selalu
 * menerima company_id, dan pencarian undangan selalu lewat hash token, sehingga
 * isolasi ditegakkan di layer data, bukan hanya di guard (TRD §6).
 */
import type { Answer } from '@siapai/scoring'

/**
 * Enum ini sengaja dinyatakan sebagai union literal, bukan `string`, agar
 * ketidakcocokan dengan kontrak OpenAPI tertangkap saat kompilasi.
 */
export type Industry =
  | 'manufacturing' | 'retail_ecommerce' | 'fnb' | 'logistics' | 'financial_services'
  | 'healthcare' | 'education' | 'professional_services' | 'construction_property'
  | 'agriculture' | 'media_creative' | 'technology' | 'government_public' | 'other'

export type EmployeeBand = '1_9' | '10_49' | '50_99' | '100_499' | '500_999' | '1000_plus'

export type RevenueBand =
  | 'under_2_5b' | '2_5b_15b' | '15b_50b' | '50b_250b' | '250b_plus' | 'undisclosed'

export type AuditorRole = 'auditor' | 'auditor_admin' | 'sysadmin'
export type AssessmentStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'SCORED' | 'ARCHIVED'
export type InvitationStatus =
  | 'SENT' | 'OPENED' | 'IN_PROGRESS' | 'SUBMITTED' | 'SCORED' | 'REVOKED' | 'EXPIRED'

export interface AuditorRow {
  id: string
  email: string
  name: string
  role: AuditorRole
}

export interface CompanyRow {
  id: string
  /** Auditor pemilik; perusahaan tidak terlihat oleh auditor lain (FR-06). */
  owner_auditor_id: string
  name: string
  industry: Industry
  employee_band: EmployeeBand
  revenue_band?: RevenueBand
  country: string
  province?: string
  created_at: string
}

export interface AssessmentRow {
  id: string
  company_id: string
  status: AssessmentStatus
  questionnaire_version: string
  rubric_version: string
  started_at: string
  submitted_at: string | null
  server_revision: number
  answers: Map<string, Answer & { answered_at: string }>
  score_snapshot?: unknown
}

export interface InvitationRow {
  id: string
  company_id: string
  assessment_id: string
  /** Hash token untuk verifikasi constant-time (FR-23 AC1). */
  token_hash: string
  /** Token terenkripsi, agar QR & tautan dapat dibuat ulang (FR-24 AC1). */
  token_sealed: string
  status: InvitationStatus
  recipient_name?: string
  recipient_email?: string
  issued_at: string
  opened_at: string | null
  submitted_at: string | null
  expires_at: string
  revoked_at: string | null
  reminder_count: number
}

/**
 * Antarmuka penyimpanan.
 *
 * Seluruh operasi asinkron, termasuk pada implementasi memori, supaya
 * penyimpanan nyata (Postgres, ADR-008) dapat dipasang tanpa mengubah modul
 * HTTP sedikit pun.
 */
export interface Repo {
  // auditor
  createAuditor(input: Omit<AuditorRow, 'id'>): Promise<AuditorRow>
  getAuditor(id: string): Promise<AuditorRow | undefined>

  // perusahaan klien
  createCompany(input: Omit<CompanyRow, 'id' | 'created_at'>): Promise<CompanyRow>
  /** Perusahaan pemilik sebuah undangan, dipakai untuk menampilkan nama. */
  getCompanyOfInvitation(inv: InvitationRow): Promise<CompanyRow | undefined>
  /** Ber-scope auditor: perusahaan milik auditor lain dianggap tidak ada. */
  getCompany(id: string, auditorId: string): Promise<CompanyRow | undefined>
  listCompanies(auditorId: string): Promise<CompanyRow[]>

  // assessment
  createAssessment(input: Omit<AssessmentRow, 'answers' | 'server_revision'>): Promise<AssessmentRow>
  getAssessment(id: string): Promise<AssessmentRow | undefined>
  saveAssessment(row: AssessmentRow): Promise<void>

  // undangan
  createInvitation(input: InvitationRow): Promise<InvitationRow>
  getInvitation(id: string): Promise<InvitationRow | undefined>
  findByTokenHash(hash: string): Promise<InvitationRow | undefined>
  findActiveByCompany(companyId: string): Promise<InvitationRow | undefined>
  listInvitations(auditorId: string): Promise<InvitationRow[]>
  saveInvitation(row: InvitationRow): Promise<void>
}

export function createMemoryRepo(): Repo {
  const auditors = new Map<string, AuditorRow>()
  const companies = new Map<string, CompanyRow>()
  const assessments = new Map<string, AssessmentRow>()
  const invitations = new Map<string, InvitationRow>()
  const byTokenHash = new Map<string, string>()

  /** Status yang masih memungkinkan responden mengisi form. */
  const ACTIVE: readonly InvitationStatus[] = ['SENT', 'OPENED', 'IN_PROGRESS']

  return {
    async createAuditor(input) {
      const row: AuditorRow = { ...input, id: crypto.randomUUID() }
      auditors.set(row.id, row)
      return row
    },
    async getAuditor(id) { return auditors.get(id) },

    async createCompany(input) {
      const row: CompanyRow = { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() }
      companies.set(row.id, row)
      return row
    },
    async getCompanyOfInvitation(inv) { return companies.get(inv.company_id) },
    async getCompany(id, auditorId) {
      const c = companies.get(id)
      return c && c.owner_auditor_id === auditorId ? c : undefined
    },
    async listCompanies(auditorId) {
      return [...companies.values()].filter((c) => c.owner_auditor_id === auditorId)
    },

    async createAssessment(input) {
      const row: AssessmentRow = { ...input, answers: new Map(), server_revision: 0 }
      assessments.set(row.id, row)
      return row
    },
    async getAssessment(id) { return assessments.get(id) },
    async saveAssessment(row) {
      assessments.set(row.id, row)
    },

    async createInvitation(input) {
      invitations.set(input.id, input)
      byTokenHash.set(input.token_hash, input.id)
      return input
    },
    async getInvitation(id) { return invitations.get(id) },
    async findByTokenHash(hash) {
      const id = byTokenHash.get(hash)
      return id ? invitations.get(id) : undefined
    },
    async findActiveByCompany(companyId) {
      for (const inv of invitations.values()) {
        if (inv.company_id === companyId && ACTIVE.includes(inv.status)) return inv
      }
      return undefined
    },
    async listInvitations(auditorId) {
      const mine = new Set(
        [...companies.values()].filter((c) => c.owner_auditor_id === auditorId).map((c) => c.id),
      )
      return [...invitations.values()]
        .filter((i) => mine.has(i.company_id))
        .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    },
    async saveInvitation(row) {
      invitations.set(row.id, row)
      byTokenHash.set(row.token_hash, row.id)
    },
  }
}
