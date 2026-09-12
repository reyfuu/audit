/** Uji perilaku: tiap test dipetakan ke requirement FRD. */
import { describe, it, expect } from 'bun:test'
import { app } from './app'

const H = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  authorization: 'Bearer valid-token',
  'x-org-id': 'org1',
  ...extra,
})
const patch = (id: string, body: unknown, headers = H()) =>
  app.handle(new Request(`http://localhost/assessments/${id}/answers`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  }))

describe('FR-09 autosave jawaban', () => {
  it('AC1: menyimpan batch dan mengembalikan server_revision + progress', async () => {
    const r = await patch('a1', { client_revision: 1, answers: [
      { question_code: 'DAT-01', value: { choice: 'opt_75' } },
      { question_code: 'STR-01', value: { choice: 'opt_50' } },
    ]})
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.saved).toBe(2)
    expect(b.server_revision).toBeGreaterThan(0)
    expect(b.progress.answered).toBe(2)
    expect(b.progress.percent).toBe(50)
  })

  it('AC1: idempoten per question_code, jawaban ulang tidak menggandakan', async () => {
    const before = await (await patch('a1', { answers: [
      { question_code: 'DAT-01', value: { choice: 'opt_100' } }]})).json()
    const after = await (await patch('a1', { answers: [
      { question_code: 'DAT-01', value: { choice: 'opt_25' } }]})).json()
    expect(after.progress.answered).toBe(before.progress.answered)
  })

  it('AC3: menolak jawaban untuk pertanyaan tidak visible -> 422 QUESTION_NOT_VISIBLE', async () => {
    const r = await patch('a1', { answers: [
      { question_code: 'PPL-07', value: { choice: 'opt_0' } }]})
    expect(r.status).toBe(422)
    const b = await r.json()
    expect(b.error.code).toBe('QUESTION_NOT_VISIBLE')
    expect(b.error.details.codes).toEqual(['PPL-07'])
  })

  it('AC4: tipe nilai salah -> 422 INVALID_ANSWER_TYPE via onError global', async () => {
    const r = await patch('a1', { answers: [
      { question_code: 'DAT-01', value: { scale: 99 } }]})   // scale harus 1..5
    expect(r.status).toBe(422)
    const b = await r.json()
    expect(b.error.code).toBe('INVALID_ANSWER_TYPE')
    expect(b.error.trace_id).toBeTruthy()
  })

  it('batch kosong ditolak (minItems 1)', async () => {
    expect((await patch('a1', { answers: [] })).status).toBe(422)
  })

  it('batch > 50 ditolak (maxItems 50)', async () => {
    const answers = Array.from({ length: 51 }, () => ({
      question_code: 'DAT-01', value: { choice: 'x' } }))
    expect((await patch('a1', { answers })).status).toBe(422)
  })
})

describe('FR-12 AC3 assessment SCORED bersifat read-only', () => {
  it('menolak perubahan dengan 409 CONFLICT', async () => {
    const r = await patch('a2', { answers: [
      { question_code: 'DAT-01', value: { choice: 'opt_75' } }]}, H({ 'x-org-id': 'org2' }))
    expect(r.status).toBe(409)
    expect((await r.json()).error.code).toBe('CONFLICT')
  })
})

describe('TRD §6 keamanan', () => {
  it('tanpa token -> 401 UNAUTHENTICATED', async () => {
    const r = await patch('a1', { answers: [
      { question_code: 'DAT-01', value: { choice: 'x' } }]},
      { 'content-type': 'application/json', 'x-org-id': 'org1' })
    expect(r.status).toBe(401)
    expect((await r.json()).error.code).toBe('UNAUTHENTICATED')
  })

  it('tanpa X-Org-Id -> 403 FORBIDDEN', async () => {
    const r = await patch('a1', { answers: [
      { question_code: 'DAT-01', value: { choice: 'x' } }]},
      { 'content-type': 'application/json', authorization: 'Bearer valid-token' })
    expect(r.status).toBe(403)
    expect((await r.json()).error.code).toBe('FORBIDDEN')
  })

  it('tenant isolation: org lain tidak bisa menyentuh assessment -> 404, bukan 403', async () => {
    const r = await patch('a2', { answers: [
      { question_code: 'DAT-01', value: { choice: 'x' } }]}, H({ 'x-org-id': 'org1' }))
    expect(r.status).toBe(404)   // tidak membocorkan keberadaan resource
  })

  it('assessment tidak ada -> 404 NOT_FOUND', async () => {
    const r = await patch('tidak-ada', { answers: [
      { question_code: 'DAT-01', value: { choice: 'x' } }]})
    expect(r.status).toBe(404)
    expect((await r.json()).error.code).toBe('NOT_FOUND')
  })
})

describe('FRD §11 amplop error seragam', () => {
  it('semua respons error memakai bentuk { error: { code, message } }', async () => {
    const cases = [
      patch('a1', { answers: [] }),
      patch('tidak-ada', { answers: [{ question_code: 'DAT-01', value: { choice: 'x' } }] }),
      patch('a1', { answers: [{ question_code: 'PPL-07', value: { choice: 'x' } }] }),
    ]
    for (const c of cases) {
      const b = await (await c).json()
      expect(b.error).toBeDefined()
      expect(typeof b.error.code).toBe('string')
      expect(typeof b.error.message).toBe('string')
    }
  })
})
