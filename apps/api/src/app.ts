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
import { authModule } from './modules/auth'
import { reportModule } from './modules/report'
import { aiReviewModule } from './modules/ai-review'
import { aiConfigFromEnv, createChatClient, type ChatClient } from '@siapai/ai'

export interface AppDeps {
  /** Penyimpanan; default in-memory. Pakai createPgRepo untuk Postgres. */
  repo?: Repo
  baseUrl?: string
  now?: () => Date
  /** Pengiriman OTP; default mencetak ke log agar demo dapat berjalan. */
  sendOtp?: (email: string, code: string) => Promise<void> | void
  /** Perender PDF; bila tidak ada, endpoint PDF membalas 503 secara jujur. */
  renderPdf?: (url: string) => Promise<ArrayBuffer>
  /**
   * Klien model untuk tinjauan AI. Bila tidak disuntikkan, dibangun dari
   * environment; bila kunci belum ada, endpoint AI melapor 503 apa adanya.
   */
  chat?: ChatClient
}

export function createApp({
  repo = createMemoryRepo(),
  baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001',
  now = () => new Date(),
  sendOtp,
  renderPdf,
  chat = defaultChat(),
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
    .use(authModule({ repo, now, ...(sendOtp ? { sendOtp } : {}) }))
    .use(companyModule({ repo }))
    .use(invitationModule({ repo, baseUrl, now }))
    .use(respondentModule({ repo, now }))
    .use(reportModule({ repo, baseUrl, now, ...(renderPdf ? { renderPdf } : {}) }))
    .use(aiReviewModule({ repo, now, ...(chat ? { chat } : {}) }))

  return { app, repo }
}

/** Klien model dari environment; undefined bila AI_API_KEY belum disetel. */
function defaultChat(): ChatClient | undefined {
  const cfg = aiConfigFromEnv()
  return cfg ? createChatClient(cfg) : undefined
}
