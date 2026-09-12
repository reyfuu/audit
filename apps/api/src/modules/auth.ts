/**
 * Modul autentikasi auditor (FR-01, FR-03, FR-04).
 *
 * Publik tidak dapat mendaftar sendiri: hanya email yang diundang
 * `auditor_admin` atau sudah menjadi auditor yang boleh meminta OTP.
 */
import { Elysia, t } from 'elysia'
import {
  OTP_MAX_ATTEMPTS, OTP_TTL_MS, REFRESH_TTL_MS,
  generateOtp, generateRefreshToken, hashOtp, hashRefreshToken,
  hashPassword, issueAccessToken, normalizeEmail, otpMatches,
  passwordIssue, verifyPassword,
} from '../lib/auth'
import { err } from '../lib/errors'
import { authGuard } from '../lib/guards'
import type { Repo } from '../lib/repo'
import * as S from '../lib/schemas'

export interface AuthDeps {
  repo: Repo
  now?: () => Date
  /**
   * Pengiriman OTP. Default mencetak ke log agar demo lokal dapat berjalan
   * tanpa layanan email; produksi menyuntikkan pengirim sungguhan.
   */
  sendOtp?: (email: string, code: string) => Promise<void> | void
}

export function authModule({ repo, now = () => new Date(), sendOtp }: AuthDeps) {
  const kirim = sendOtp ?? ((email: string, code: string) => {
    // eslint-disable-next-line no-console
    console.log(`[OTP] ${email} → ${code}`)
  })

  return new Elysia({ prefix: '/auth' })
    // ── FR-02 login kata sandi
    //
    // Jalur masuk utama auditor. Tidak ada login pihak ketiga: satu jalur yang
    // dipahami penuh lebih aman daripada dua jalur yang setengah dimengerti.
    .post(
      '/login',
      async ({ body, status }) => {
        const email = normalizeEmail(body.email)
        const auditor = await repo.getAuditorByEmail(email)
        // Pesan yang sama untuk email salah maupun kata sandi salah, agar
        // endpoint ini tidak menjadi alat memeriksa siapa yang terdaftar.
        const gagal = () =>
          status(401, err('UNAUTHENTICATED', 'Email atau kata sandi salah'))
        if (!auditor || !verifyPassword(body.password, auditor.password_hash)) {
          return gagal()
        }
        return status(200, await terbitkanSesi(auditor.id, auditor.role, crypto.randomUUID()))
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          password: t.String({ minLength: 1, maxLength: 200 }),
        }),
        response: { 200: S.TokenPair, 401: S.ErrorEnvelope, 422: S.ErrorEnvelope },
        detail: { tags: ['Auth'], summary: 'Login auditor dengan email dan kata sandi' },
      },
    )

    // ── FR-01 minta OTP
    .post(
      '/request-otp',
      async ({ body, status }) => {
        const email = normalizeEmail(body.email)
        const auditor = await repo.getAuditorByEmail(email)
        const invite = await repo.getAuditorInviteByEmail(email)
        const inviteBerlaku = invite
          && !invite.accepted_at
          && new Date(invite.expires_at).getTime() > now().getTime()

        // FR-01 AC3: publik tidak bisa mendaftar sendiri. Namun responsnya
        // tetap 202 agar tidak menjadi orakel daftar email auditor.
        if (auditor || inviteBerlaku) {
          const code = generateOtp()
          const at = now()
          const challenge = await repo.createOtpChallenge({
            id: crypto.randomUUID(),
            email,
            code_hash: hashOtp(email, code),
            attempts: 0,
            consumed_at: null,
            expires_at: new Date(at.getTime() + OTP_TTL_MS).toISOString(),
          })
          await kirim(email, code)
          return status(202, {
            challenge_id: challenge.id,
            expires_at: challenge.expires_at,
          })
        }

        // Tetap kembalikan bentuk yang sama dengan id acak yang tidak berlaku.
        return status(202, {
          challenge_id: crypto.randomUUID(),
          expires_at: new Date(now().getTime() + OTP_TTL_MS).toISOString(),
        })
      },
      {
        body: t.Object({ email: t.String({ format: 'email' }) }),
        response: {
          202: t.Object({ challenge_id: t.String(), expires_at: t.String() }),
          422: S.ErrorEnvelope,
        },
        detail: { tags: ['Auth'], summary: 'Minta kode OTP untuk login auditor' },
      },
    )

    // ── FR-01 + FR-03 verifikasi OTP, terbitkan sesi
    .post(
      '/verify-otp',
      async ({ body, status }) => {
        const gagal = () => status(401, err('UNAUTHENTICATED', 'Kode tidak valid atau kedaluwarsa'))

        const c = await repo.getOtpChallenge(body.challenge_id)
        if (!c) return gagal()
        if (c.consumed_at) return gagal()
        if (new Date(c.expires_at).getTime() <= now().getTime()) return gagal()
        // FR-01 AC2: batasi percobaan agar kode 6 digit tidak dapat ditebak.
        if (c.attempts >= OTP_MAX_ATTEMPTS) {
          return status(429, err('RATE_LIMITED', 'Terlalu banyak percobaan. Minta kode baru.'))
        }

        if (!otpMatches(c.email, body.code, c.code_hash)) {
          c.attempts += 1
          await repo.saveOtpChallenge(c)
          return gagal()
        }

        c.consumed_at = now().toISOString()
        await repo.saveOtpChallenge(c)

        // Buat akun saat undangan pertama kali dipakai.
        let auditor = await repo.getAuditorByEmail(c.email)
        if (!auditor) {
          const invite = await repo.getAuditorInviteByEmail(c.email)
          if (!invite || invite.accepted_at
              || new Date(invite.expires_at).getTime() <= now().getTime()) {
            return gagal()
          }
          auditor = await repo.createAuditor({
            email: c.email,
            name: body.name ?? c.email.split('@')[0]!,
            role: invite.role,
          })
          invite.accepted_at = now().toISOString()
          await repo.saveAuditorInvite(invite)
        }

        return status(200, await terbitkanSesi(auditor.id, auditor.role, crypto.randomUUID()))
      },
      {
        body: t.Object({
          challenge_id: t.String(),
          code: t.String({ pattern: '^[0-9]{6}$' }),
          name: t.Optional(t.String({ maxLength: 120 })),
        }),
        response: {
          200: S.TokenPair, 401: S.ErrorEnvelope, 429: S.ErrorEnvelope, 422: S.ErrorEnvelope,
        },
        detail: { tags: ['Auth'], summary: 'Verifikasi OTP dan terbitkan sesi' },
      },
    )

    // ── FR-03 rotasi refresh token
    .post(
      '/refresh',
      async ({ body, status }) => {
        const gagal = () => status(401, err('UNAUTHENTICATED', 'Sesi tidak valid'))
        const sesi = await repo.findSessionByTokenHash(hashRefreshToken(body.refresh_token))
        if (!sesi) return gagal()
        if (sesi.revoked_at) return gagal()

        // Token rotatif bersifat sekali pakai. Pemakaian ulang berarti token
        // bocor, sehingga seluruh keluarga dicabut, bukan hanya token ini.
        if (sesi.used_at) {
          await repo.revokeSessionFamily(sesi.family_id, now().toISOString())
          return gagal()
        }
        if (new Date(sesi.expires_at).getTime() <= now().getTime()) return gagal()

        const auditor = await repo.getAuditor(sesi.auditor_id)
        if (!auditor) return gagal()

        sesi.used_at = now().toISOString()
        await repo.saveSession(sesi)
        return status(200, await terbitkanSesi(auditor.id, auditor.role, sesi.family_id))
      },
      {
        body: t.Object({ refresh_token: t.String() }),
        response: { 200: S.TokenPair, 401: S.ErrorEnvelope, 422: S.ErrorEnvelope },
        detail: { tags: ['Auth'], summary: 'Rotasi refresh token' },
      },
    )

    // ── FR-03 logout
    .post(
      '/logout',
      async ({ body, status }) => {
        const sesi = await repo.findSessionByTokenHash(hashRefreshToken(body.refresh_token))
        // Mencabut seluruh keluarga: logout harus mengakhiri rantai sesi ini.
        if (sesi) await repo.revokeSessionFamily(sesi.family_id, now().toISOString())
        return status(204, undefined)
      },
      {
        body: t.Object({ refresh_token: t.String() }),
        response: { 204: t.Void(), 422: S.ErrorEnvelope },
        detail: { tags: ['Auth'], summary: 'Cabut sesi' },
      },
    )

    // ── profil pemanggil
    .use(authGuard)
    .get(
      '/me',
      async ({ user, status }) => {
        const a = await repo.getAuditor(user!.id)
        if (!a) return status(401, err('UNAUTHENTICATED', 'Akun tidak ditemukan'))
        return { id: a.id, email: a.email, name: a.name, role: a.role }
      },
      {
        response: { 200: S.Me, 401: S.ErrorEnvelope },
        detail: { tags: ['Auth'], summary: 'Profil auditor yang sedang masuk' },
      },
    )

    // ── FR-02 tetapkan atau ganti kata sandi
    .post(
      '/password',
      async ({ body, user, status }) => {
        const auditor = await repo.getAuditor(user!.id)
        if (!auditor) return status(401, err('UNAUTHENTICATED', 'Akun tidak ditemukan'))
        // Bila sudah punya kata sandi, wajib membuktikan yang lama. Sesi yang
        // dibajak tidak boleh cukup untuk mengunci pemilik aslinya.
        if (auditor.password_hash
            && !verifyPassword(body.current_password ?? '', auditor.password_hash)) {
          return status(401, err('UNAUTHENTICATED', 'Kata sandi saat ini salah'))
        }
        const masalah = passwordIssue(body.new_password)
        if (masalah) return status(422, err('INVALID_ANSWER_TYPE', masalah))
        await repo.setAuditorPassword(auditor.id, hashPassword(body.new_password))
        return status(204, undefined)
      },
      {
        body: t.Object({
          current_password: t.Optional(t.String({ maxLength: 200 })),
          new_password: t.String({ maxLength: 200 }),
        }),
        response: {
          204: t.Void(), 401: S.ErrorEnvelope, 422: S.ErrorEnvelope,
        },
        detail: { tags: ['Auth'], summary: 'Tetapkan atau ganti kata sandi' },
      },
    )

    // ── FR-04 undang anggota tim auditor
    .post(
      '/invites',
      async ({ body, user, status }) => {
        const pengundang = await repo.getAuditor(user!.id)
        if (pengundang?.role !== 'auditor_admin' && pengundang?.role !== 'sysadmin') {
          return status(403, err('FORBIDDEN', 'Hanya admin yang dapat mengundang anggota'))
        }
        const email = normalizeEmail(body.email)
        if (await repo.getAuditorByEmail(email)) {
          return status(409, err('CONFLICT', 'Email sudah terdaftar sebagai auditor'))
        }
        const invite = await repo.createAuditorInvite({
          id: crypto.randomUUID(),
          email,
          role: body.role ?? 'auditor',
          invited_by: pengundang.id,
          accepted_at: null,
          // FR-04: tautan undangan berlaku 7 hari.
          expires_at: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        return status(201, {
          email: invite.email, role: invite.role, expires_at: invite.expires_at,
        })
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          role: t.Optional(t.Union([t.Literal('auditor'), t.Literal('auditor_admin')])),
        }),
        response: {
          201: t.Object({ email: t.String(), role: t.String(), expires_at: t.String() }),
          401: S.ErrorEnvelope, 403: S.ErrorEnvelope, 409: S.ErrorEnvelope, 422: S.ErrorEnvelope,
        },
        detail: { tags: ['Auth'], summary: 'Undang anggota tim auditor' },
      },
    )

  async function terbitkanSesi(auditorId: string, role: string, familyId: string) {
    const access = issueAccessToken(auditorId, role, now().getTime())
    const refresh = generateRefreshToken()
    await repo.createSession({
      id: crypto.randomUUID(),
      auditor_id: auditorId,
      token_hash: hashRefreshToken(refresh),
      family_id: familyId,
      used_at: null,
      revoked_at: null,
      expires_at: new Date(now().getTime() + REFRESH_TTL_MS).toISOString(),
    })
    return {
      access_token: access.token,
      refresh_token: refresh,
      expires_in: access.expires_in,
    }
  }
}
