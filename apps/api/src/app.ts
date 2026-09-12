/**
 * Komposisi aplikasi (TRD §13).
 * Modul dirakit di sini; dependensi disuntikkan eksplisit agar mudah diuji.
 */
import { Elysia } from 'elysia'
import { err } from './lib/errors'
import { createMemoryRepo, type Repo } from './lib/repo'
import { invitationModule } from './modules/invitation'
import { respondentModule } from './modules/respondent'
import { companyModule } from './modules/company'

export interface AppDeps {
  /** Penyimpanan; default in-memory. Pakai createPgRepo untuk Postgres. */
  repo?: Repo
  baseUrl?: string
  now?: () => Date
}

export function createApp({
  repo = createMemoryRepo(),
  baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001',
  now = () => new Date(),
}: AppDeps = {}) {
  const app = new Elysia()
    // FRD §11: satu tempat memetakan error ke amplop seragam.
    .onError(({ code, error, status }) => {
      if (code === 'VALIDATION') {
        return status(422, err('INVALID_ANSWER_TYPE',
          'Data yang dikirim tidak sesuai format yang diharapkan',
          { validation: String((error as Error).message).slice(0, 300) }))
      }
      if (code === 'NOT_FOUND') return status(404, err('NOT_FOUND', 'Tidak ditemukan'))
      return status(500, err('INTERNAL', 'Terjadi kesalahan internal'))
    })
    .get('/health', () => ({ ok: true }))
    .use(companyModule({ repo }))
    .use(invitationModule({ repo, baseUrl, now }))
    .use(respondentModule({ repo, now }))

  return { app, repo }
}
