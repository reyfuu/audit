/**
 * Modul undangan & QR code (FR-23, FR-24, FR-27, FR-29).
 * Jalur auditor: memerlukan Bearer token.
 */
import { Elysia, t } from 'elysia'
import QRCode from 'qrcode'
import { QUESTIONNAIRE_V1 as QN } from '@siapai/scoring'
import { err } from '../lib/errors'
import { authGuard } from '../lib/guards'
import type { InvitationRow, Repo } from '../lib/repo'
import { generateToken, hashToken, invitationUrl, openToken, sealToken } from '../lib/token'
import * as S from '../lib/schemas'
import { progressOf } from './progress'

export interface InvitationDeps {
  repo: Repo
  baseUrl: string
  now?: () => Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Undangan yang lewat masa berlaku dianggap EXPIRED walau belum ada cron (FR-28 AC1). */
export function effectiveStatus(inv: InvitationRow, now: Date): InvitationRow['status'] {
  if (inv.status === 'REVOKED' || inv.status === 'SCORED' || inv.status === 'SUBMITTED') {
    return inv.status
  }
  return new Date(inv.expires_at).getTime() <= now.getTime() ? 'EXPIRED' : inv.status
}

export function invitationModule({ repo, baseUrl, now = () => new Date() }: InvitationDeps) {
  const toDto = (inv: InvitationRow) => {
    const company = repo.getCompanyOfInvitation(inv)
    const assessment = repo.getAssessment(inv.assessment_id)
    return {
      id: inv.id,
      company_id: inv.company_id,
      company_name: company?.name ?? '',
      assessment_id: inv.assessment_id,
      status: effectiveStatus(inv, now()),
      ...(inv.recipient_name ? { recipient_name: inv.recipient_name } : {}),
      ...(inv.recipient_email ? { recipient_email: inv.recipient_email } : {}),
      progress: assessment ? progressOf(assessment) : {
        answered: 0, total_visible: 0, percent: 0, estimated_minutes_left: 0,
      },
      issued_at: inv.issued_at,
      opened_at: inv.opened_at,
      submitted_at: inv.submitted_at,
      expires_at: inv.expires_at,
      reminder_count: inv.reminder_count,
    }
  }

  /** Membuat baris undangan baru untuk assessment yang sudah ada. */
  function issue(
    companyId: string,
    assessmentId: string,
    expiresInDays: number,
    recipient: { name?: string; email?: string },
  ) {
    const token = generateToken()
    const at = now()
    const row: InvitationRow = {
      id: crypto.randomUUID(),
      company_id: companyId,
      assessment_id: assessmentId,
      token_hash: hashToken(token),
      token_sealed: sealToken(token),
      status: 'SENT',
      ...(recipient.name ? { recipient_name: recipient.name } : {}),
      ...(recipient.email ? { recipient_email: recipient.email } : {}),
      issued_at: at.toISOString(),
      opened_at: null,
      submitted_at: null,
      expires_at: new Date(at.getTime() + expiresInDays * DAY_MS).toISOString(),
      revoked_at: null,
      reminder_count: 0,
    }
    repo.createInvitation(row)
    return { row, token }
  }

  const withSecrets = (row: InvitationRow, token: string) => ({
    ...toDto(row),
    // FR-23 AC1: token mentah hanya muncul di sini, sekali.
    token,
    invitation_url: invitationUrl(baseUrl, token),
    qr_png_url: `${baseUrl}/v1/invitations/${row.id}/qr.png`,
    qr_svg_url: `${baseUrl}/v1/invitations/${row.id}/qr.svg`,
  })

  return new Elysia({ prefix: '/invitations' })
    .use(authGuard)

    // ── FR-23 terbitkan undangan
    .post(
      '/',
      ({ body, user, status }) => {
        const company = repo.getCompany(body.company_id, user!.id)
        // 404 alih-alih 403: jangan bocorkan perusahaan milik auditor lain.
        if (!company) return status(404, err('NOT_FOUND', 'Perusahaan tidak ditemukan'))

        const active = repo.findActiveByCompany(company.id)
        if (active && effectiveStatus(active, now()) !== 'EXPIRED') {
          return status(409, err('CONFLICT', 'Masih ada undangan aktif untuk perusahaan ini', {
            invitation_id: active.id,
          }))
        }

        // FR-23 AC3: assessment dibuat bersamaan, versi dikunci saat ini.
        const assessment = repo.createAssessment({
          id: crypto.randomUUID(),
          company_id: company.id,
          status: 'IN_PROGRESS',
          questionnaire_version: QN.version,
          rubric_version: QN.rubric_version,
          started_at: now().toISOString(),
          submitted_at: null,
        })

        const { row, token } = issue(company.id, assessment.id, body.expires_in_days ?? 30, {
          ...(body.recipient_name !== undefined ? { name: body.recipient_name } : {}),
          ...(body.recipient_email !== undefined ? { email: body.recipient_email } : {}),
        })
        return status(201, withSecrets(row, token))
      },
      {
        body: t.Object({
          company_id: t.String(),
          expires_in_days: t.Optional(t.Union([t.Literal(7), t.Literal(30), t.Literal(90)])),
          recipient_name: t.Optional(t.String({ maxLength: 120 })),
          recipient_email: t.Optional(t.String({ format: 'email' })),
        }),
        response: {
          201: S.InvitationCreated, 401: S.ErrorEnvelope,
          404: S.ErrorEnvelope, 409: S.ErrorEnvelope,
        },
        detail: { tags: ['Invitations'], summary: 'Terbitkan undangan form untuk owner' },
      },
    )

    // ── FR-29 dashboard auditor
    .get(
      '/',
      ({ user }) => ({ items: repo.listInvitations(user!.id).map(toDto) }),
      {
        response: { 200: t.Object({ items: t.Array(S.Invitation) }), 401: S.ErrorEnvelope },
        detail: { tags: ['Invitations'], summary: 'Daftar undangan beserta status' },
      },
    )

    .get(
      '/:id',
      ({ params, user, status }) => {
        const inv = ownedInvitation(repo, params.id, user!.id)
        if (!inv) return status(404, err('NOT_FOUND', 'Undangan tidak ditemukan'))
        // Auditor pemilik boleh melihat kembali tautannya: ia memang berhak
        // membagikannya, dan memaksanya menerbitkan ulang hanya untuk menyalin
        // tautan akan membatalkan QR yang mungkin sudah dicetak.
        const st = effectiveStatus(inv, now())
        const bisaDibagikan = st !== 'REVOKED' && st !== 'EXPIRED'
        return {
          ...toDto(inv),
          ...(bisaDibagikan
            ? { invitation_url: invitationUrl(baseUrl, openToken(inv.token_sealed)) }
            : {}),
        }
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 200: S.InvitationDetail, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['Invitations'], summary: 'Detail satu undangan' },
      },
    )

    // ── FR-27 AC1 cabut
    .delete(
      '/:id',
      ({ params, user, status }) => {
        const inv = ownedInvitation(repo, params.id, user!.id)
        if (!inv) return status(404, err('NOT_FOUND', 'Undangan tidak ditemukan'))
        inv.status = 'REVOKED'
        inv.revoked_at = now().toISOString()
        repo.saveInvitation(inv)
        return status(204, undefined)
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 204: t.Void(), 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['Invitations'], summary: 'Cabut undangan' },
      },
    )

    // ── FR-27 AC2 terbitkan ulang; jawaban dipertahankan
    .post(
      '/:id/reissue',
      ({ params, user, status }) => {
        const old = ownedInvitation(repo, params.id, user!.id)
        if (!old) return status(404, err('NOT_FOUND', 'Undangan tidak ditemukan'))

        old.status = 'REVOKED'
        old.revoked_at = now().toISOString()
        repo.saveInvitation(old)

        // Assessment yang sama dipakai ulang, sehingga jawaban tidak hilang.
        const { row, token } = issue(old.company_id, old.assessment_id, 30, {
          ...(old.recipient_name !== undefined ? { name: old.recipient_name } : {}),
          ...(old.recipient_email !== undefined ? { email: old.recipient_email } : {}),
        })
        return status(201, withSecrets(row, token))
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 201: S.InvitationCreated, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['Invitations'], summary: 'Terbitkan ulang token & QR' },
      },
    )

    // ── FR-24 QR PNG
    .get(
      '/:id/qr.png',
      async ({ params, query, user, status, set }) => {
        const inv = ownedInvitation(repo, params.id, user!.id)
        if (!inv) return status(404, err('NOT_FOUND', 'Undangan tidak ditemukan'))
        // FR-24 AC1: isi QR HARUS sama persis dengan invitation_url.
        const url = invitationUrl(baseUrl, openToken(inv.token_sealed))
        const buf = await QRCode.toBuffer(url, {
          errorCorrectionLevel: 'M',
          width: query.size ?? 512,
          margin: 2,
        })
        set.headers['content-type'] = 'image/png'
        set.headers['cache-control'] = 'private, no-store'
        return new Response(new Uint8Array(buf))
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          size: t.Optional(t.Integer({ minimum: 256, maximum: 2048 })),
          print_label: t.Optional(t.Boolean()),
        }),
        detail: { tags: ['Invitations'], summary: 'QR code undangan (PNG)' },
      },
    )

    // ── FR-24 QR SVG
    .get(
      '/:id/qr.svg',
      async ({ params, user, status, set }) => {
        const inv = ownedInvitation(repo, params.id, user!.id)
        if (!inv) return status(404, err('NOT_FOUND', 'Undangan tidak ditemukan'))
        const svg = await QRCode.toString(invitationUrl(baseUrl, openToken(inv.token_sealed)), {
          type: 'svg', errorCorrectionLevel: 'M', margin: 2,
        })
        set.headers['content-type'] = 'image/svg+xml'
        set.headers['cache-control'] = 'private, no-store'
        return svg
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Invitations'], summary: 'QR code undangan (SVG)' },
      },
    )
}

function ownedInvitation(repo: Repo, invitationId: string, auditorId: string) {
  const inv = repo.getInvitation(invitationId)
  if (!inv) return undefined
  return repo.getCompany(inv.company_id, auditorId) ? inv : undefined
}
