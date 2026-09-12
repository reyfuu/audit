/**
 * Spike verifikasi pola arsitektur TRD §13 di Elysia nyata.
 * Tujuan: membuktikan pola yang didokumentasikan benar-benar jalan,
 * bukan pseudocode. Ini BUKAN kode produksi.
 */
import { Elysia, t } from 'elysia'

// ── Skema bersama (mencerminkan components.schemas di contracts/openapi.yaml)
export const ErrorEnvelope = t.Object({
  error: t.Object({
    code: t.Union([
      t.Literal('UNAUTHENTICATED'), t.Literal('FORBIDDEN'), t.Literal('NOT_FOUND'),
      t.Literal('CONFLICT'), t.Literal('INCOMPLETE'), t.Literal('INVALID_ANSWER_TYPE'),
      t.Literal('QUESTION_NOT_VISIBLE'), t.Literal('RATE_LIMITED'),
      t.Literal('PAYMENT_REQUIRED'), t.Literal('INTERNAL'),
    ]),
    message: t.String(),
    details: t.Optional(t.Record(t.String(), t.Unknown())),
    trace_id: t.Optional(t.String()),
  }),
})

export const AnswerValue = t.Union([
  t.Object({ choice: t.String() }),
  t.Object({ choices: t.Array(t.String()) }),
  t.Object({ scale: t.Integer({ minimum: 1, maximum: 5 }) }),
  t.Object({ bool: t.Boolean() }),
  t.Object({ number: t.Number() }),
  t.Object({ text: t.String({ maxLength: 1000 }) }),
])

export const AnswerBatch = t.Object({
  client_revision: t.Optional(t.Integer({ minimum: 0 })),
  answers: t.Array(
    t.Object({
      question_code: t.String(),
      value: AnswerValue,
      evidence_url: t.Optional(t.String({ format: 'uri' })),
    }),
    { minItems: 1, maxItems: 50 },
  ),
})

export const Progress = t.Object({
  answered: t.Integer(), total_visible: t.Integer(),
  percent: t.Number({ minimum: 0, maximum: 100 }),
  estimated_minutes_left: t.Optional(t.Integer()),
})

export const SaveResult = t.Object({
  saved: t.Integer(),
  server_revision: t.Integer(),
  progress: Progress,
  newly_visible: t.Array(t.String()),
  newly_hidden: t.Array(t.String()),
})

// ── Penyimpanan in-memory untuk spike
type Store = Map<string, { org: string; status: string; revision: number; answers: Map<string, unknown> }>
const store: Store = new Map([
  ['a1', { org: 'org1', status: 'IN_PROGRESS', revision: 0, answers: new Map() }],
  ['a2', { org: 'org2', status: 'SCORED', revision: 7, answers: new Map() }],
])
const VISIBLE = new Set(['DAT-01', 'DAT-02', 'DAT-03', 'STR-01'])
const TOTAL_VISIBLE = VISIBLE.size

// ── ADR-007: guard sebagai plugin yang dapat dikomposisi (pengganti NestJS guard)
const authGuard = new Elysia({ name: 'authGuard' })
  .derive({ as: 'scoped' }, ({ headers }) => ({
    user: headers.authorization === 'Bearer valid-token' ? { id: 'u1' } : null,
  }))
  .onBeforeHandle({ as: 'scoped' }, ({ user, status }) => {
    if (!user)
      return status(401, { error: { code: 'UNAUTHENTICATED' as const, message: 'Token tidak valid' } })
  })

// ── Tenant isolation (TRD §6): X-Org-Id wajib dan harus cocok dengan pemilik data
const orgScope = new Elysia({ name: 'orgScope' })
  .derive({ as: 'scoped' }, ({ headers }) => ({ orgId: headers['x-org-id'] ?? null }))
  .onBeforeHandle({ as: 'scoped' }, ({ orgId, status }) => {
    if (!orgId)
      return status(403, { error: { code: 'FORBIDDEN' as const, message: 'X-Org-Id wajib diisi' } })
  })

// ── FRD §11: satu onError global memetakan error ke amplop seragam
export const app = new Elysia()
  .onError(({ code, error, status }) => {
    if (code === 'VALIDATION')
      return status(422, {
        error: {
          code: 'INVALID_ANSWER_TYPE' as const,
          message: 'Bentuk jawaban tidak sesuai definisi pertanyaan',
          details: { validation: String(error.message).slice(0, 200) },
          trace_id: crypto.randomUUID(),
        },
      })
    if (code === 'NOT_FOUND')
      return status(404, { error: { code: 'NOT_FOUND' as const, message: 'Tidak ditemukan' } })
    return status(500, { error: { code: 'INTERNAL' as const, message: 'Kesalahan internal' } })
  })
  .use(authGuard)
  .use(orgScope)
  .patch(
    '/assessments/:id/answers',
    ({ params, body, orgId, status }) => {
      const a = store.get(params.id)
      if (!a) return status(404, { error: { code: 'NOT_FOUND' as const, message: 'Assessment tidak ada' } })
      // Tenant isolation ganda: guard + filter di layer data
      if (a.org !== orgId)
        return status(404, { error: { code: 'NOT_FOUND' as const, message: 'Assessment tidak ada' } })
      // FR-12 AC3: SCORED bersifat read-only
      if (a.status !== 'IN_PROGRESS')
        return status(409, { error: { code: 'CONFLICT' as const, message: 'Assessment sudah dikunci' } })
      // FR-09 AC3: tolak pertanyaan yang tidak visible
      const hidden = body.answers.filter((x) => !VISIBLE.has(x.question_code))
      if (hidden.length)
        return status(422, {
          error: {
            code: 'QUESTION_NOT_VISIBLE' as const,
            message: 'Ada jawaban untuk pertanyaan yang tidak tampil',
            details: { codes: hidden.map((h) => h.question_code) },
          },
        })
      // FR-09 AC1: upsert idempoten per question_code
      for (const ans of body.answers) a.answers.set(ans.question_code, ans.value)
      a.revision += 1
      const answered = a.answers.size
      return {
        saved: body.answers.length,
        server_revision: a.revision,
        progress: {
          answered,
          total_visible: TOTAL_VISIBLE,
          percent: Math.round((answered / TOTAL_VISIBLE) * 1000) / 10,
        },
        newly_visible: [],
        newly_hidden: [],
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: AnswerBatch,
      response: {
        200: SaveResult,
        404: ErrorEnvelope,
        409: ErrorEnvelope,
        422: ErrorEnvelope,
      },
    },
  )
