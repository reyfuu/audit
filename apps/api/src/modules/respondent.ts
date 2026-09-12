/**
 * Modul responden (FR-25, FR-26, FR-08, FR-09, FR-11, FR-12, FR-16).
 *
 * Semua endpoint di sini diautentikasi oleh token undangan di path, bukan
 * Bearer. Owner tidak punya akun dan tidak mengetahui id internal apa pun.
 */
import { Elysia, t } from 'elysia'
import {
  QUESTIONNAIRE_V1 as QN, RECOMMENDATION_CATALOG as CATALOG,
  SECTION_NAMES, SECTION_ORDER,
  missingRequired, recommend, score, scoreAnswer,
} from '@siapai/scoring'
import { err } from '../lib/errors'
import type { AssessmentRow, InvitationRow, Repo } from '../lib/repo'
import { hashToken } from '../lib/token'
import * as S from '../lib/schemas'
import { answersOf, progressOf, visibleQuestionsOf } from './progress'
import { effectiveStatus } from './invitation'

export interface RespondentDeps {
  repo: Repo
  now?: () => Date
}

/** Status yang masih mengizinkan pengisian. */
const FILLABLE = new Set(['SENT', 'OPENED', 'IN_PROGRESS'])

export function respondentModule({ repo, now = () => new Date() }: RespondentDeps) {
  /**
   * Menyelesaikan token menjadi undangan + assessment.
   * Mengembalikan null untuk token tidak dikenal, dicabut, atau kedaluwarsa,
   * sehingga pemanggil selalu membalas 404 netral (FR-25 AC3).
   */
  async function resolve(token: string): Promise<{ inv: InvitationRow; a: AssessmentRow } | null> {
    const inv = await repo.findByTokenHash(hashToken(token))
    if (!inv) return null
    const st = effectiveStatus(inv, now())
    if (st === 'REVOKED' || st === 'EXPIRED') return null
    const a = await repo.getAssessment(inv.assessment_id)
    return a ? { inv, a } : null
  }

  const invalid = () =>
    err('INVITATION_INVALID', 'Tautan ini sudah tidak berlaku. Hubungi auditor Anda untuk tautan baru.')

  /** Menaikkan status undangan tanpa pernah menurunkannya. */
  async function advance(inv: InvitationRow, to: InvitationRow['status']) {
    const order = ['SENT', 'OPENED', 'IN_PROGRESS', 'SUBMITTED', 'SCORED']
    if (order.indexOf(to) > order.indexOf(inv.status)) {
      inv.status = to
      await repo.saveInvitation(inv)
    }
  }

  return new Elysia({ prefix: '/f' })
    // Halaman form tidak boleh terindeks mesin pencari (FR-25 AC5).
    .onAfterHandle(({ set }) => {
      set.headers['x-robots-tag'] = 'noindex, nofollow'
    })

    // ── FR-25 halaman sambutan
    .get(
      '/:token',
      async ({ params, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { inv, a } = r

        // FR-25 AC2: pembukaan pertama menandai OPENED.
        if (inv.status === 'SENT') {
          inv.opened_at = now().toISOString()
          await advance(inv, 'OPENED')
        }
        const company = await repo.getCompanyOfInvitation(inv)
        const auditor = company ? await repo.getAuditor(company.owner_auditor_id) : undefined
        const p = progressOf(a)
        return {
          company_name: company?.name ?? '',
          invited_by: auditor?.name ?? 'Tim auditor',
          total_questions: p.total_visible,
          estimated_minutes: Math.max(1, Math.ceil((p.total_visible * 25) / 60)),
          status: effectiveStatus(inv, now()),
          progress: p,
          expires_at: inv.expires_at,
          // FR-26: owner tahu bahwa ia melanjutkan, bukan memulai dari nol.
          resume: a.answers.size > 0,
        }
      },
      {
        params: t.Object({ token: t.String() }),
        response: { 200: S.FormWelcome, 404: S.ErrorEnvelope },
        detail: { tags: ['Respondent'], summary: 'Halaman sambutan form undangan' },
      },
    )

    // ── FR-08 seksi berikutnya
    .get(
      '/:token/next',
      async ({ params, query, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { a } = r

        const visible = visibleQuestionsOf(a)
        // Seksi dibangun dari SECTION_ORDER agar seksi profil (ORG) ikut tampil
        // dengan namanya sendiri, bukan menumpang nama dimensi berskor.
        const dims = SECTION_ORDER
          .filter((code) => visible.some((q) => q.dimension_code === code))
          .map((code) => ({
            code,
            name: SECTION_NAMES[code],
            weight: QN.dimensions.find((d) => d.code === code)?.weight ?? 0,
          }))
        const target = query.section
          ? dims.find((d) => d.code === query.section)
          : dims.find((d) =>
              visible.some((q) => q.dimension_code === d.code && !a.answers.has(q.code)),
            ) ?? dims[dims.length - 1]
        if (!target) return status(404, err('NOT_FOUND', 'Seksi tidak ditemukan'))

        const questions = visible
          .filter((q) => q.dimension_code === target.code)
          .map(({ code, dimension_code, type, prompt, help_text, weight, required,
                  options, min_select, max_select }) => ({
            code, dimension_code, type, prompt, weight, required,
            ...(help_text ? { help_text } : {}),
            ...(options ? { options } : {}),
            ...(min_select !== undefined ? { min_select } : {}),
            ...(max_select !== undefined ? { max_select } : {}),
          }))

        return {
          dimension: target,
          section_index: dims.indexOf(target) + 1,
          section_total: dims.length,
          questions,
          answers: questions
            .map((q) => a.answers.get(q.code))
            .filter((x): x is NonNullable<typeof x> => x !== undefined)
            .map(({ question_code, value, evidence_url }) => ({
              question_code, value, ...(evidence_url ? { evidence_url } : {}),
            })),
          progress: progressOf(a),
        }
      },
      {
        params: t.Object({ token: t.String() }),
        query: t.Object({ section: t.Optional(t.String()) }),
        response: { 200: S.SectionPayload, 404: S.ErrorEnvelope },
        detail: { tags: ['Respondent'], summary: 'Ambil seksi pertanyaan berikutnya' },
      },
    )

    // ── FR-09 autosave
    .patch(
      '/:token/answers',
      async ({ params, body, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { inv, a } = r
        if (!FILLABLE.has(effectiveStatus(inv, now()))) {
          return status(409, err('CONFLICT', 'Form sudah dikirim dan tidak dapat diubah lagi'))
        }

        const before = new Set(visibleQuestionsOf(a).map((q) => q.code))
        const known = new Map(QN.questions.map((q) => [q.code, q]))

        // Validasi seluruh batch dulu agar penyimpanan bersifat atomik.
        const unknown: string[] = []
        const hidden: string[] = []
        const wrongType: string[] = []
        for (const ans of body.answers) {
          const q = known.get(ans.question_code)
          if (!q) { unknown.push(ans.question_code); continue }
          if (!before.has(ans.question_code)) { hidden.push(ans.question_code); continue }
          if (!q.unscored && q.type !== 'text' && scoreAnswer(q, ans.value) === null) {
            wrongType.push(ans.question_code)
          }
        }
        if (unknown.length) {
          return status(404, err('NOT_FOUND', 'Ada pertanyaan yang tidak dikenal', { codes: unknown }))
        }
        if (hidden.length) {
          return status(422, err('QUESTION_NOT_VISIBLE',
            'Ada jawaban untuk pertanyaan yang sedang tidak tampil', { codes: hidden }))
        }
        if (wrongType.length) {
          return status(422, err('INVALID_ANSWER_TYPE',
            'Bentuk jawaban tidak sesuai definisi pertanyaan', { codes: wrongType }))
        }

        // FR-09 AC1: upsert idempoten per question_code.
        for (const ans of body.answers) {
          a.answers.set(ans.question_code, {
            question_code: ans.question_code,
            value: ans.value,
            ...(ans.evidence_url ? { evidence_url: ans.evidence_url } : {}),
            answered_at: now().toISOString(),
          })
        }
        a.server_revision += 1
        await repo.saveAssessment(a)
        await advance(inv, 'IN_PROGRESS')

        const after = new Set(visibleQuestionsOf(a).map((q) => q.code))
        const newly_visible = [...after].filter((c) => !before.has(c)).sort()
        const newly_hidden = [...before].filter((c) => !after.has(c)).sort()
        // Jawaban yang menjadi tidak relevan dibuang agar tidak ikut terskor.
        for (const c of newly_hidden) a.answers.delete(c)
        if (newly_hidden.length) await repo.saveAssessment(a)

        return {
          saved: body.answers.length,
          server_revision: a.server_revision,
          progress: progressOf(a),
          newly_visible,
          newly_hidden,
        }
      },
      {
        params: t.Object({ token: t.String() }),
        body: S.AnswerBatch,
        response: { 200: S.SaveResult, 404: S.ErrorEnvelope,
                    409: S.ErrorEnvelope, 422: S.ErrorEnvelope },
        detail: { tags: ['Respondent'], summary: 'Simpan batch jawaban (autosave)' },
      },
    )

    // ── FR-11 review sebelum kirim
    .get(
      '/:token/review',
      async ({ params, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { a } = r
        return {
          progress: progressOf(a),
          missing: missingRequired(answersOf(a), QN),
          answers: [...a.answers.values()],
        }
      },
      {
        params: t.Object({ token: t.String() }),
        response: {
          200: t.Object({
            progress: S.Progress,
            missing: t.Array(t.String()),
            answers: t.Array(t.Composite([S.AnswerInput, t.Object({ answered_at: t.String() })])),
          }),
          404: S.ErrorEnvelope,
        },
        detail: { tags: ['Respondent'], summary: 'Ringkasan jawaban & yang masih kosong' },
      },
    )

    // ── FR-12 kirim & skoring
    .post(
      '/:token/submit',
      async ({ params, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { inv, a } = r
        if (a.status !== 'IN_PROGRESS') {
          return status(409, err('CONFLICT', 'Form sudah pernah dikirim'))
        }

        const answers = answersOf(a)
        const missing = missingRequired(answers, QN)
        if (missing.length) {
          return status(422, err('INCOMPLETE',
            `Masih ada ${missing.length} pertanyaan wajib yang belum dijawab`, { missing }))
        }

        const result = score({ answers, questionnaire: QN })
        const at = now().toISOString()
        a.status = 'SCORED'
        a.submitted_at = at
        a.score_snapshot = result
        await repo.saveAssessment(a)
        inv.submitted_at = at
        inv.status = 'SCORED'
        await repo.saveInvitation(inv)

        return toResultDto(a.id, result, at)
      },
      {
        params: t.Object({ token: t.String() }),
        response: { 200: S.ScoreResult, 404: S.ErrorEnvelope,
                    409: S.ErrorEnvelope, 422: S.ErrorEnvelope },
        detail: { tags: ['Respondent'], summary: 'Kirim jawaban dan jalankan skoring' },
      },
    )

    // ── FR-16 hasil, terbuka penuh (FR-30)
    .get(
      '/:token/result',
      async ({ params, status }) => {
        const r = await resolve(params.token)
        if (!r) return status(404, invalid())
        const { a } = r
        if (a.status !== 'SCORED' || !a.score_snapshot) {
          return status(409, err('CONFLICT', 'Form belum dikirim, hasil belum tersedia'))
        }
        const snapshot = a.score_snapshot as ReturnType<typeof score>
        return {
          // ADR-004: baca snapshot, jangan hitung ulang.
          result: toResultDto(a.id, snapshot, a.submitted_at ?? now().toISOString()),
          recommendations: recommend(snapshot, CATALOG),
        }
      },
      {
        params: t.Object({ token: t.String() }),
        response: {
          200: t.Object({ result: S.ScoreResult, recommendations: S.RecommendationBundle }),
          404: S.ErrorEnvelope, 409: S.ErrorEnvelope,
        },
        detail: { tags: ['Respondent'], summary: 'Hasil audit, tanpa bagian terkunci' },
      },
    )
}

/** Ringkasan naratif untuk halaman hasil (DESIGN B5). */
function summarize(r: ReturnType<typeof score>): string {
  const terlemah = [...r.dimensions]
    .filter((d) => d.counted_questions > 0)
    .sort((a, b) => a.score - b.score)[0]
  const gate = r.gates.find((g) => g.triggered)
  const verdictText: Record<string, string> = {
    READY: 'Perusahaan Anda siap memulai inisiatif AI.',
    CONDITIONALLY_READY: 'Perusahaan Anda siap bersyarat: ada fondasi yang perlu ditutup lebih dulu.',
    NOT_READY: 'Perusahaan Anda belum siap memulai inisiatif AI.',
  }
  const parts = [
    `Skor kesiapan ${r.total_score} dari 100 (level ${r.level}).`,
    verdictText[r.verdict]!,
  ]
  if (terlemah) parts.push(`Dimensi terlemah adalah ${terlemah.name} dengan skor ${terlemah.score}.`)
  if (gate) parts.push(gate.message)
  return parts.join(' ')
}

export function toResultDto(id: string, r: ReturnType<typeof score>, at: string) {
  return {
    assessment_id: id,
    total_score: r.total_score,
    level: r.level,
    verdict: r.verdict,
    confidence: r.confidence,
    gates: r.gates,
    dimensions: r.dimensions.map((d) => ({
      dimension_code: d.dimension_code,
      name: d.name,
      score: d.score,
      level: d.level,
      weight: d.weight,
      benchmark_percentile: null,
    })),
    // FR-15 AC2: jangan tampilkan angka pembanding palsu saat sampel belum cukup.
    benchmark_available: false,
    rubric_version: r.rubric_version,
    computed_at: at,
    summary: summarize(r),
  }
}
