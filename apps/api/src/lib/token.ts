/**
 * Token undangan (FR-23 AC1, FR-24 AC1, TRD §6).
 *
 * Dua kebutuhan yang tampak bertentangan:
 *  - Verifikasi token harus aman bila basis data bocor  → simpan hash.
 *  - QR dan tautan harus dapat dibuat ulang kapan saja  → token harus dapat
 *    dipulihkan oleh server.
 *
 * Keputusan: simpan **hash** untuk verifikasi (cepat, constant-time) dan
 * **ciphertext AES-256-GCM** untuk pemulihan. Kunci enkripsi berada di secret
 * manager, terpisah dari basis data, sehingga dump basis data saja tidak cukup
 * untuk memulihkan token. Alternatif "QR menunjuk ke endpoint pengalih"
 * ditolak karena membuat isi QR berbeda dari tautan undangan dan menambah satu
 * titik gagal pada jalur masuk utama pengguna.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 byte acak dari CSPRNG, base64url agar aman di URL dan padat di QR. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

const PEPPER = process.env.INVITATION_PEPPER ?? 'dev-only-pepper'

/** Kunci 32 byte. Di produksi wajib dari secret manager. */
function key(): Buffer {
  const raw = process.env.INVITATION_KEY ?? 'dev-only-key-change-me'
  return createHash('sha256').update(raw).digest()
}

export function hashToken(token: string): string {
  return createHash('sha256').update(`${PEPPER}:${token}`).digest('hex')
}

/** Perbandingan constant-time agar tidak bocor lewat timing. */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Enkripsi token untuk disimpan; format `iv.tag.ciphertext` dalam base64url. */
export function sealToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ct].map((b) => b.toString('base64url')).join('.')
}

/** Memulihkan token untuk membuat ulang QR dan tautan. */
export function openToken(sealed: string): string {
  const [ivB64, tagB64, ctB64] = sealed.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Format token tersegel tidak valid')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function invitationUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/f/${token}`
}
