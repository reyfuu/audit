/**
 * Modul laporan: tautan bagikan dan ekspor PDF (FR-17, FR-18).
 *
 * PDF dihasilkan dengan merender halaman hasil yang sama persis (ADR-005),
 * sehingga isinya tidak pernah menyimpang dari yang dilihat di layar.
 */
import { Elysia, t } from 'elysia'
import { RECOMMENDATION_CATALOG as CATALOG, recommend, type score } from '@siapai/scoring'
import { err } from '../lib/errors'
import { authGuard } from '../lib/guards'
import type { Repo, ShareLinkRow } from '../lib/repo'
import * as S from '../lib/schemas'
import { generateToken, hashToken, openToken, sealToken } from '../lib/token'
import { toResultDto } from './respondent'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ReportDeps {
  repo: Repo
  baseUrl: string
  now?: () => Date
  /**
   * Perender PDF. Disuntikkan agar uji tidak perlu menjalankan browser,
   * dan agar implementasinya (Playwright) tidak mengikat modul ini.
   */
  renderPdf?: (url: string) => Promise<ArrayBuffer>
}

export function shareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/l/${token}`
}

/** Berlaku bila belum dicabut dan belum kedaluwarsa. */
export function shareBerlaku(row: ShareLinkRow, now: Date): boolean {
  if (row.revoked_at) return false
  return new Date(row.expires_at).getTime() > now.getTime()
}

export function reportModule({ repo, baseUrl, now = () => new Date(), renderPdf }: ReportDeps) {
  /** Assessment yang benar-benar milik auditor pemanggil dan sudah diskor. */
  async function assessmentTerskor(assessmentId: string, auditorId: string) {
    const a = await repo.getAssessment(assessmentId)
    if (!a) return null
    const c = await repo.getCompany(a.company_id, auditorId)
    if (!c) return null // milik auditor lain: dianggap tidak ada
    return { a, c }
  }

  const publik = new Elysia()
    // ── FR-18 membuka laporan yang dibagikan, tanpa akun
    .get(
      '/l/:token',
      async ({ params, status }) => {
        const row = await repo.findShareLinkByTokenHash(hashToken(params.token))
        if (!row || !shareBerlaku(row, now())) {
          return status(404, err('NOT_FOUND', 'Tautan laporan sudah tidak berlaku'))
        }
        const a = await repo.getAssessment(row.assessment_id)
        if (!a?.score_snapshot) {
          return status(404, err('NOT_FOUND', 'Laporan tidak ditemukan'))
        }
        row.view_count += 1
        await repo.saveShareLink(row)

        const snapshot = a.score_snapshot as ReturnType<typeof score>
        const company = await repo.getCompanyById(a.company_id)
        return {
          // FR-18: opsi menyembunyikan identitas saat dibagikan ke luar.
          company_name: row.anonymize ? null : company?.name ?? null,
          result: toResultDto(a.id, snapshot, a.submitted_at ?? now().toISOString()),
          recommendations: recommend(snapshot, CATALOG),
        }
      },
      {
        params: t.Object({ token: t.String() }),
        response: { 200: S.SharedReport, 404: S.ErrorEnvelope },
        detail: { tags: ['Reports'], summary: 'Lihat laporan yang dibagikan' },
      },
    )

  return new Elysia()
    .use(publik)
    .use(authGuard)

    // ── FR-18 buat tautan bagikan
    .post(
      '/assessments/:id/share-links',
      async ({ params, body, user, status }) => {
        const found = await assessmentTerskor(params.id, user!.id)
        if (!found) return status(404, err('NOT_FOUND', 'Assessment tidak ditemukan'))
        if (!found.a.score_snapshot) {
          return status(409, err('CONFLICT', 'Laporan belum tersedia; assessment belum diskor'))
        }

        const token = generateToken()
        const hari = body?.expires_in_days ?? 30
        const row = await repo.createShareLink({
          id: crypto.randomUUID(),
          assessment_id: found.a.id,
          token_hash: hashToken(token),
          token_sealed: sealToken(token),
          anonymize: body?.anonymize ?? false,
          created_by: user!.id,
          expires_at: new Date(now().getTime() + hari * DAY_MS).toISOString(),
          revoked_at: null,
          view_count: 0,
        })
        return status(201, {
          id: row.id,
          url: shareUrl(baseUrl, token),
          expires_at: row.expires_at,
          anonymize: row.anonymize,
          view_count: row.view_count,
        })
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Optional(t.Object({
          expires_in_days: t.Optional(t.Union([t.Literal(7), t.Literal(30), t.Literal(90)])),
          anonymize: t.Optional(t.Boolean()),
        })),
        response: {
          201: S.ShareLink, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope,
          409: S.ErrorEnvelope, 422: S.ErrorEnvelope,
        },
        detail: { tags: ['Reports'], summary: 'Buat tautan bagikan read-only' },
      },
    )

    // ── daftar tautan bagikan
    .get(
      '/assessments/:id/share-links',
      async ({ params, user, status }) => {
        const found = await assessmentTerskor(params.id, user!.id)
        if (!found) return status(404, err('NOT_FOUND', 'Assessment tidak ditemukan'))
        const rows = await repo.listShareLinks(found.a.id)
        return {
          items: rows.map((r) => ({
            id: r.id,
            // Tautan dapat dilihat ulang oleh pemiliknya; ia memang berhak membagikannya.
            url: shareBerlaku(r, now()) ? shareUrl(baseUrl, openToken(r.token_sealed)) : null,
            expires_at: r.expires_at,
            anonymize: r.anonymize,
            revoked: Boolean(r.revoked_at),
            view_count: r.view_count,
          })),
        }
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Object({ items: t.Array(S.ShareLinkListItem) }),
          401: S.ErrorEnvelope, 404: S.ErrorEnvelope,
        },
        detail: { tags: ['Reports'], summary: 'Daftar tautan bagikan' },
      },
    )

    // ── FR-18 cabut tautan
    .delete(
      '/share-links/:id',
      async ({ params, user, status }) => {
        const row = await repo.getShareLink(params.id)
        // Kepemilikan diverifikasi lewat assessment dan perusahaannya, sehingga
        // auditor lain tidak dapat mencabut tautan yang bukan miliknya.
        const milik = row && await assessmentTerskor(row.assessment_id, user!.id)
        if (!row || !milik) return status(404, err('NOT_FOUND', 'Tautan tidak ditemukan'))
        row.revoked_at = now().toISOString()
        await repo.saveShareLink(row)
        return status(204, undefined)
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 204: t.Void(), 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['Reports'], summary: 'Cabut tautan bagikan' },
      },
    )

    // ── FR-17 ekspor PDF
    .post(
      '/assessments/:id/report/pdf',
      async ({ params, user, status, set }) => {
        const found = await assessmentTerskor(params.id, user!.id)
        if (!found) return status(404, err('NOT_FOUND', 'Assessment tidak ditemukan'))
        if (!found.a.score_snapshot) {
          return status(409, err('CONFLICT', 'Laporan belum tersedia; assessment belum diskor'))
        }
        if (!renderPdf) {
          return status(503, err('INTERNAL', 'Perender PDF belum tersedia di lingkungan ini'))
        }

        // ADR-005: render halaman hasil yang sama, lewat tautan bagikan
        // sementara, agar isi PDF identik dengan tampilan layar.
        const token = generateToken()
        const row = await repo.createShareLink({
          id: crypto.randomUUID(),
          assessment_id: found.a.id,
          token_hash: hashToken(token),
          token_sealed: sealToken(token),
          anonymize: false,
          created_by: user!.id,
          // Umur pendek: tautan ini hanya alat internal untuk merender.
          expires_at: new Date(now().getTime() + 5 * 60 * 1000).toISOString(),
          revoked_at: null,
          view_count: 0,
        })

        try {
          const pdf = await renderPdf(shareUrl(baseUrl, token))
          set.headers['content-type'] = 'application/pdf'
          set.headers['content-disposition'] =
            `attachment; filename="laporan-kesiapan-ai-${found.c.name.replace(/[^\w]+/g, '-').toLowerCase()}.pdf"`
          set.headers['cache-control'] = 'private, no-store'
          return new Response(pdf)
        } finally {
          // Tautan sementara selalu dicabut, termasuk bila render gagal.
          row.revoked_at = now().toISOString()
          await repo.saveShareLink(row)
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Reports'], summary: 'Unduh laporan sebagai PDF' },
      },
    )
}
