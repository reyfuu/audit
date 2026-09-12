/**
 * Skema basis data (TRD §4).
 *
 * Enum ditegakkan di level basis data agar data tidak bisa menyimpang dari
 * kontrak meski ada jalur tulis lain di masa depan. Indeks mengikuti pola akses
 * nyata: pencarian undangan selalu lewat hash token, dan daftar selalu
 * ber-scope pemilik.
 */
import { relations } from 'drizzle-orm'
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

export const auditorRole = pgEnum('auditor_role', ['auditor', 'auditor_admin', 'sysadmin'])

export const industry = pgEnum('industry', [
  'manufacturing', 'retail_ecommerce', 'fnb', 'logistics', 'financial_services',
  'healthcare', 'education', 'professional_services', 'construction_property',
  'agriculture', 'media_creative', 'technology', 'government_public', 'other',
])

export const employeeBand = pgEnum('employee_band', [
  '1_9', '10_49', '50_99', '100_499', '500_999', '1000_plus',
])

export const revenueBand = pgEnum('revenue_band', [
  'under_2_5b', '2_5b_15b', '15b_50b', '50b_250b', '250b_plus', 'undisclosed',
])

export const assessmentStatus = pgEnum('assessment_status', [
  'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'ARCHIVED',
])

export const invitationStatus = pgEnum('invitation_status', [
  'SENT', 'OPENED', 'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'REVOKED', 'EXPIRED',
])

export const auditors = pgTable('auditors', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: auditorRole('role').notNull().default('auditor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('auditors_email_key').on(t.email)])

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Pemilik data; menjadi dasar isolasi antar auditor (FR-06). */
  ownerAuditorId: uuid('owner_auditor_id').notNull()
    .references(() => auditors.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  industry: industry('industry').notNull(),
  employeeBand: employeeBand('employee_band').notNull(),
  revenueBand: revenueBand('revenue_band'),
  country: text('country').notNull().default('ID'),
  province: text('province'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('companies_owner_idx').on(t.ownerAuditorId)])

export const assessments = pgTable('assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  status: assessmentStatus('status').notNull().default('IN_PROGRESS'),
  /** Versi dikunci saat dibuat sehingga skor lama tetap dapat direproduksi (PA5). */
  questionnaireVersion: text('questionnaire_version').notNull(),
  rubricVersion: text('rubric_version').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  serverRevision: integer('server_revision').notNull().default(0),
  /** Snapshot hasil skoring; dibaca apa adanya saat menampilkan laporan (ADR-004). */
  scoreSnapshot: jsonb('score_snapshot'),
}, (t) => [index('assessments_company_idx').on(t.companyId, t.status)])

export const answers = pgTable('answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  assessmentId: uuid('assessment_id').notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  questionCode: text('question_code').notNull(),
  value: jsonb('value').notNull(),
  evidenceUrl: text('evidence_url'),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Menjamin idempotensi autosave di level basis data, bukan hanya di aplikasi.
  uniqueIndex('answers_assessment_question_key').on(t.assessmentId, t.questionCode),
])

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  /** Hash token untuk verifikasi; token mentah tidak pernah disimpan polos. */
  tokenHash: text('token_hash').notNull(),
  /** Token terenkripsi agar QR dan tautan dapat dibuat ulang (FR-24 AC1). */
  tokenSealed: text('token_sealed').notNull(),
  status: invitationStatus('status').notNull().default('SENT'),
  recipientName: text('recipient_name'),
  recipientEmail: text('recipient_email'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  reminderCount: integer('reminder_count').notNull().default(0),
}, (t) => [
  // Jalur panas: setiap permintaan responden mencari undangan lewat hash token.
  uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
  index('invitations_company_idx').on(t.companyId, t.status),
])

/**
 * Tantangan OTP untuk login auditor (FR-01).
 * Kode disimpan sebagai hash agar bocornya basis data tidak langsung memberi akses.
 */
export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('otp_email_idx').on(t.email, t.createdAt)])

/**
 * Refresh token rotatif (FR-03).
 * Menyimpan hash; token yang sudah dipakai ditandai agar pemakaian ulang
 * terdeteksi sebagai indikasi pencurian token.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditorId: uuid('auditor_id').notNull()
    .references(() => auditors.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  /** Keluarga token: seluruh rantai rotasi berbagi nilai ini. */
  familyId: uuid('family_id').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
  index('sessions_family_idx').on(t.familyId),
])

/** Email yang boleh mendaftar sebagai auditor (FR-01 AC3). */
export const auditorInvites = pgTable('auditor_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: auditorRole('role').notNull().default('auditor'),
  invitedBy: uuid('invited_by').references(() => auditors.id, { onDelete: 'set null' }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('auditor_invites_email_key').on(t.email)])

/**
 * Tautan bagikan read-only untuk laporan (FR-18).
 * Berbeda dari undangan: tidak memberi hak mengisi, hanya membaca hasil.
 */
export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  assessmentId: uuid('assessment_id').notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  tokenSealed: text('token_sealed').notNull(),
  /** Menyembunyikan nama perusahaan saat laporan dibagikan ke luar. */
  anonymize: boolean('anonymize').notNull().default(false),
  createdBy: uuid('created_by').references(() => auditors.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('share_links_token_hash_key').on(t.tokenHash),
  index('share_links_assessment_idx').on(t.assessmentId),
])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id'),
  companyId: uuid('company_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  meta: jsonb('meta'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_logs_company_idx').on(t.companyId, t.createdAt)])

export const companiesRelations = relations(companies, ({ one, many }) => ({
  owner: one(auditors, { fields: [companies.ownerAuditorId], references: [auditors.id] }),
  assessments: many(assessments),
  invitations: many(invitations),
}))

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  company: one(companies, { fields: [assessments.companyId], references: [companies.id] }),
  answers: many(answers),
}))

export const invitationsRelations = relations(invitations, ({ one }) => ({
  company: one(companies, { fields: [invitations.companyId], references: [companies.id] }),
  assessment: one(assessments, { fields: [invitations.assessmentId], references: [assessments.id] }),
}))
