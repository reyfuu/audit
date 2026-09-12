/**
 * Modul tinjauan AI (FR-31).
 *
 * Skor tetap deterministik dari rubrik; AI dipakai untuk hal yang tidak dapat
 * dilihat aturan, yaitu kualitas jawaban itu sendiri. Hasilnya disimpan sebagai
 * snapshot pada assessment supaya laporan tidak memanggil model berulang kali
 * dan biaya tetap terkendali saat jumlah perusahaan bertambah.
 */
import { Elysia, t } from 'elysia'
import { QUESTIONNAIRE_V1 as QN, type Answer, type score } from '@siapai/scoring'
import { AiError, reviewAnswers, type ChatClient, type ReviewInput, type ReviewResult } from '@siapai/ai'
import { err } from '../lib/errors'
import { authGuard } from '../lib/guards'
import type { AssessmentRow, Repo } from '../lib/repo'
import * as S from '../lib/schemas'
import { answersOf } from './progress'

/**
 * Banyaknya tinjauan yang berjalan bersamaan pada mode massal.
 * Dipilih konservatif: cukup memangkas waktu tunggu, tetapi tidak agresif
 * sehingga penyedia model membalas dengan rate limit.
 */
export const BATCH_CONCURRENCY = 4

export interface AiReviewDeps {
  repo: Repo
  /** Klien model; bila tidak ada, endpoint melapor 503 secara jujur. */
  chat?: ChatClient
  now?: () => Date
}

/** Menerjemahkan nilai jawaban menjadi teks yang dapat dibaca model. */
export function answerText(questionCode: string, value: Answer['value']): string {
  const q = QN.questions.find((x) => x.code === questionCode)
  const label = (code: string) =>
    q?.options?.find((o) => o.code === code)?.label ?? code
  if ('choice' in value) return label(value.choice)
  if ('choices' in value) return value.choices.map(label).join(', ') || '(tidak memilih apa pun)'
  if ('scale' in value) return `${value.scale} dari 5`
  if ('bool' in value) return value.bool ? 'Ya' : 'Belum'
  if ('number' in value) return String(value.number)
  if ('text' in value) return value.text
  return '(tidak diisi)'
}

/** Menyusun masukan tinjauan dari satu assessment yang sudah diskor. */
export function buildReviewInput(
  a: AssessmentRow,
  company: { name: string; industry: string; employee_band: string },
): ReviewInput {
  const snapshot = a.score_snapshot as ReturnType<typeof score>
  return {
    company,
    score: {
      total_score: snapshot.total_score,
      verdict: snapshot.verdict,
      level: snapshot.level,
    },
    dimensions: snapshot.dimensions.map((d) => ({
      dimension_code: d.dimension_code, name: d.name, score: d.score,
    })),
    answers: answersOf(a).map((ans) => ({
      question_code: ans.question_code,
      prompt: QN.questions.find((q) => q.code === ans.question_code)?.prompt ?? ans.question_code,
      answer: answerText(ans.question_code, ans.value),
    })),
  }
}

export function aiReviewModule({ repo, chat, now = () => new Date() }: AiReviewDeps) {
  /** Assessment milik auditor pemanggil; milik orang lain dianggap tidak ada. */
  async function milik(assessmentId: string, auditorId: string) {
    const a = await repo.getAssessment(assessmentId)
    if (!a) return null
    const c = await repo.getCompany(a.company_id, auditorId)
    return c ? { a, c } : null
  }

  /** Menjalankan tinjauan dan menyimpan snapshotnya. */
  async function jalankan(a: AssessmentRow, c: {
    name: string; industry: string; employee_band: string
  }): Promise<ReviewResult> {
    const hasil = await reviewAnswers(chat!, buildReviewInput(a, c), now)
    a.ai_review = hasil
    await repo.saveAssessment(a)
    return hasil
  }

  return new Elysia()
    .use(authGuard)

    // ── FR-31 jalankan tinjauan untuk satu assessment
    .post(
      '/assessments/:id/ai-review',
      async ({ params, query, user, status }) => {
        const found = await milik(params.id, user!.id)
        if (!found) return status(404, err('NOT_FOUND', 'Assessment tidak ditemukan'))
        if (!found.a.score_snapshot) {
          return status(409, err('CONFLICT', 'Form belum dikirim; belum ada yang bisa ditinjau'))
        }
        if (!chat) {
          return status(503, err('INTERNAL', 'Model AI belum dikonfigurasi di lingkungan ini'))
        }
        // Tinjauan yang sudah ada dipakai ulang kecuali diminta ulang secara
        // eksplisit; ini yang menjaga biaya tetap wajar pada ratusan perusahaan.
        if (found.a.ai_review && query.refresh !== '1') {
          return found.a.ai_review as ReviewResult
        }
        try {
          return await jalankan(found.a, found.c)
        } catch (e: unknown) {
          if (e instanceof AiError) {
            return status(503, err('INTERNAL', `Tinjauan AI gagal: ${e.message}`))
          }
          throw e
        }
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ refresh: t.Optional(t.String()) }),
        response: {
          200: S.AiReview, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope,
          409: S.ErrorEnvelope, 503: S.ErrorEnvelope,
        },
        detail: { tags: ['AI'], summary: 'Tinjau jawaban dengan AI' },
      },
    )

    // ── ambil tinjauan tersimpan tanpa memanggil model
    .get(
      '/assessments/:id/ai-review',
      async ({ params, user, status }) => {
        const found = await milik(params.id, user!.id)
        if (!found) return status(404, err('NOT_FOUND', 'Assessment tidak ditemukan'))
        if (!found.a.ai_review) {
          return status(404, err('NOT_FOUND', 'Belum ada tinjauan AI untuk assessment ini'))
        }
        return found.a.ai_review as ReviewResult
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 200: S.AiReview, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['AI'], summary: 'Ambil tinjauan AI tersimpan' },
      },
    )

    // ── FR-32 tinjau banyak assessment sekaligus
    //
    // Dengan ratusan perusahaan, meninjau satu per satu lewat UI tidak masuk
    // akal. Endpoint ini memproses antrean yang belum pernah ditinjau.
    .post(
      '/ai-review/batch',
      async ({ body, user, status }) => {
        if (!chat) {
          return status(503, err('INTERNAL', 'Model AI belum dikonfigurasi di lingkungan ini'))
        }
        const batas = body?.limit ?? 10
        const companies = await repo.listCompanies(user!.id)
        const invitations = await repo.listInvitations(user!.id)
        const byCompany = new Map(companies.map((c) => [c.id, c]))

        // Kumpulkan antrean lebih dulu, baru dikerjakan.
        const antre: { a: AssessmentRow; c: { name: string; industry: string; employee_band: string } }[] = []
        for (const inv of invitations) {
          if (antre.length >= batas) break
          const a = await repo.getAssessment(inv.assessment_id)
          const c = byCompany.get(inv.company_id)
          if (!a || !c || !a.score_snapshot) continue
          if (a.ai_review && !body?.refresh) continue
          antre.push({ a, c })
        }

        /**
         * Dikerjakan beberapa sekaligus. Satu tinjauan memakan beberapa detik,
         * sehingga antrean 25 secara berurutan berarti auditor menunggu
         * menit-menit di depan layar. Konkurensi dibatasi agar tidak
         * membanjiri penyedia model dan tetap ramah pada rate limit.
         */
        const hasil: { assessment_id: string; company_name: string; status: string }[] = []
        const pekerja = Array.from(
          { length: Math.min(BATCH_CONCURRENCY, antre.length) },
          async () => {
            for (;;) {
              const tugas = antre.shift()
              if (!tugas) return
              try {
                await jalankan(tugas.a, tugas.c)
                hasil.push({
                  assessment_id: tugas.a.id, company_name: tugas.c.name, status: 'reviewed',
                })
              } catch (e: unknown) {
                // Satu kegagalan model tidak boleh membatalkan seluruh antrean.
                hasil.push({
                  assessment_id: tugas.a.id,
                  company_name: tugas.c.name,
                  status: e instanceof AiError ? `failed: ${e.message}` : 'failed',
                })
              }
            }
          },
        )
        await Promise.all(pekerja)

        // Urutan hasil mengikuti selesainya pekerjaan; urutkan ulang agar
        // tampilan stabil dan tidak berubah-ubah antar pemanggilan.
        hasil.sort((x, y) => x.company_name.localeCompare(y.company_name))
        return { reviewed: hasil.filter((x) => x.status === 'reviewed').length, items: hasil }
      },
      {
        body: t.Optional(t.Object({
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
          refresh: t.Optional(t.Boolean()),
        })),
        response: {
          200: t.Object({
            reviewed: t.Integer(),
            items: t.Array(t.Object({
              assessment_id: t.String(), company_name: t.String(), status: t.String(),
            })),
          }),
          401: S.ErrorEnvelope, 503: S.ErrorEnvelope, 422: S.ErrorEnvelope,
        },
        detail: { tags: ['AI'], summary: 'Tinjau antrean assessment secara massal' },
      },
    )
}
