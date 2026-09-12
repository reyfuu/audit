/**
 * Uji autentikasi auditor (FR-01, FR-03, FR-04).
 * Termasuk skenario penyalahgunaan, bukan hanya jalur bahagia.
 */
import { describe, expect, it } from 'bun:test'
import { createApp } from '../src/app'
import { createMemoryRepo } from '../src/lib/repo'
import {
  hashPassword, issueAccessToken, verifyAccessToken, verifyPassword,
} from '../src/lib/auth'
import { parseBearer } from '../src/lib/guards'

const BASE = 'http://localhost:3001'

function setup(now: () => Date = () => new Date()) {
  const repo = createMemoryRepo()
  const kirim: { email: string; code: string }[] = []
  const { app } = createApp({
    repo, baseUrl: BASE, now,
    sendOtp: (email, code) => { kirim.push({ email, code }) },
  })
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.handle(new Request(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
  return { app, repo, kirim, call }
}

/** Menyiapkan satu auditor admin yang sudah terdaftar. */
async function adminTerdaftar(t: ReturnType<typeof setup>, email = 'admin@x.id') {
  return t.repo.createAuditor({ email, name: 'Admin', role: 'auditor_admin' })
}

/** Login penuh: minta OTP, ambil kodenya dari pengirim uji, verifikasi. */
async function login(t: ReturnType<typeof setup>, email: string) {
  const req = await (await t.call('/auth/request-otp', { email })).json()
  const code = t.kirim.at(-1)!.code
  const res = await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code })
  return { status: res.status, body: await res.json() }
}

describe('FR-01 permintaan OTP', () => {
  it('AC3: email yang belum diundang tidak menerima kode', async () => {
    const t = setup()
    const res = await t.call('/auth/request-otp', { email: 'orang.asing@x.id' })
    expect(res.status).toBe(202)
    expect(t.kirim).toHaveLength(0)
  })

  it('respons untuk email terdaftar dan tidak terdaftar tidak dapat dibedakan', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const terdaftar = await t.call('/auth/request-otp', { email: 'admin@x.id' })
    const asing = await t.call('/auth/request-otp', { email: 'asing@x.id' })
    expect(terdaftar.status).toBe(asing.status)
    const a = await terdaftar.json()
    const b = await asing.json()
    // Bentuk respons identik; hanya berbeda pada nilai acak.
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
  })

  it('auditor terdaftar menerima kode 6 digit', async () => {
    const t = setup()
    await adminTerdaftar(t)
    await t.call('/auth/request-otp', { email: 'admin@x.id' })
    expect(t.kirim).toHaveLength(1)
    expect(t.kirim[0]!.code).toMatch(/^\d{6}$/)
  })

  it('email diperlakukan tanpa peduli huruf besar kecil', async () => {
    const t = setup()
    await adminTerdaftar(t)
    // Huruf besar harus tetap cocok dengan akun yang tersimpan huruf kecil.
    await t.call('/auth/request-otp', { email: 'ADMIN@X.ID' })
    expect(t.kirim).toHaveLength(1)
    expect(t.kirim[0]!.email).toBe('admin@x.id')
  })

  it('kode tidak pernah disimpan polos di basis data', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const req = await (await t.call('/auth/request-otp', { email: 'admin@x.id' })).json()
    const c = await t.repo.getOtpChallenge(req.challenge_id)
    expect(c!.code_hash).not.toBe(t.kirim[0]!.code)
    expect(c!.code_hash.length).toBeGreaterThan(20)
  })
})

describe('FR-01 verifikasi OTP', () => {
  it('kode benar menghasilkan pasangan token', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { status, body } = await login(t, 'admin@x.id')
    expect(status).toBe(200)
    expect(body.access_token.split('.')).toHaveLength(3)
    expect(body.refresh_token.length).toBeGreaterThan(20)
    expect(body.expires_in).toBe(900)
  })

  it('kode salah ditolak', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const req = await (await t.call('/auth/request-otp', { email: 'admin@x.id' })).json()
    const res = await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code: '000000' })
    expect(res.status).toBe(401)
  })

  it('AC2: percobaan dibatasi agar kode 6 digit tidak dapat ditebak', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const req = await (await t.call('/auth/request-otp', { email: 'admin@x.id' })).json()
    const benar = t.kirim[0]!.code
    const salah = benar === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      expect((await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code: salah })).status).toBe(401)
    }
    // Percobaan keenam ditolak sebagai rate limit, bahkan dengan kode yang benar.
    const res = await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code: benar })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('kode tidak dapat dipakai dua kali', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const req = await (await t.call('/auth/request-otp', { email: 'admin@x.id' })).json()
    const code = t.kirim[0]!.code
    expect((await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code })).status).toBe(200)
    expect((await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code })).status).toBe(401)
  })

  it('AC1: kode kedaluwarsa setelah 10 menit', async () => {
    let sekarang = new Date('2026-01-01T00:00:00Z')
    const t = setup(() => sekarang)
    await adminTerdaftar(t)
    const req = await (await t.call('/auth/request-otp', { email: 'admin@x.id' })).json()
    const code = t.kirim[0]!.code

    sekarang = new Date('2026-01-01T00:11:00Z')
    expect((await t.call('/auth/verify-otp', { challenge_id: req.challenge_id, code })).status).toBe(401)
  })

  it('challenge_id palsu ditolak', async () => {
    const t = setup()
    const res = await t.call('/auth/verify-otp', {
      challenge_id: crypto.randomUUID(), code: '123456',
    })
    expect(res.status).toBe(401)
  })
})

describe('FR-04 undangan anggota tim', () => {
  it('admin dapat mengundang, dan yang diundang bisa login', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body: sesi } = await login(t, 'admin@x.id')

    const undang = await t.call('/auth/invites', { email: 'baru@x.id' },
      { authorization: `Bearer ${sesi.access_token}` })
    expect(undang.status).toBe(201)

    // Yang diundang kini boleh meminta OTP dan akunnya dibuat saat verifikasi.
    const { status, body } = await login(t, 'baru@x.id')
    expect(status).toBe(200)
    expect(body.access_token).toBeTruthy()

    const akun = await t.repo.getAuditorByEmail('baru@x.id')
    expect(akun?.role).toBe('auditor')
  })

  it('auditor biasa tidak boleh mengundang', async () => {
    const t = setup()
    await t.repo.createAuditor({ email: 'biasa@x.id', name: 'Biasa', role: 'auditor' })
    const { body: sesi } = await login(t, 'biasa@x.id')
    const res = await t.call('/auth/invites', { email: 'x@x.id' },
      { authorization: `Bearer ${sesi.access_token}` })
    expect(res.status).toBe(403)
  })

  it('tanpa token tidak boleh mengundang', async () => {
    const t = setup()
    expect((await t.call('/auth/invites', { email: 'x@x.id' })).status).toBe(401)
  })

  it('mengundang email yang sudah jadi auditor ditolak', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body: sesi } = await login(t, 'admin@x.id')
    const res = await t.call('/auth/invites', { email: 'admin@x.id' },
      { authorization: `Bearer ${sesi.access_token}` })
    expect(res.status).toBe(409)
  })

  it('peran yang diberikan saat undangan dihormati', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body: sesi } = await login(t, 'admin@x.id')
    await t.call('/auth/invites', { email: 'admin2@x.id', role: 'auditor_admin' },
      { authorization: `Bearer ${sesi.access_token}` })
    await login(t, 'admin2@x.id')
    expect((await t.repo.getAuditorByEmail('admin2@x.id'))?.role).toBe('auditor_admin')
  })

  it('undangan kedaluwarsa setelah 7 hari', async () => {
    let sekarang = new Date('2026-01-01T00:00:00Z')
    const t = setup(() => sekarang)
    await adminTerdaftar(t)
    const { body: sesi } = await login(t, 'admin@x.id')
    await t.call('/auth/invites', { email: 'telat@x.id' },
      { authorization: `Bearer ${sesi.access_token}` })

    sekarang = new Date('2026-01-09T00:00:00Z')
    await t.call('/auth/request-otp', { email: 'telat@x.id' })
    // Tidak ada kode baru terkirim untuk undangan yang sudah lewat.
    expect(t.kirim.filter((k) => k.email === 'telat@x.id')).toHaveLength(0)
  })
})

describe('FR-03 sesi dan rotasi token', () => {
  it('access token membuka endpoint terlindungi', async () => {
    const t = setup()
    const a = await adminTerdaftar(t)
    const { body } = await login(t, 'admin@x.id')
    const me = await t.call('/auth/me', undefined, { authorization: `Bearer ${body.access_token}` })
    expect(me.status).toBe(200)
    const profil = await me.json()
    expect(profil.id).toBe(a.id)
    expect(profil.email).toBe('admin@x.id')
  })

  it('refresh menghasilkan token baru dan token lama mati', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body: awal } = await login(t, 'admin@x.id')

    const r1 = await t.call('/auth/refresh', { refresh_token: awal.refresh_token })
    expect(r1.status).toBe(200)
    const baru = await r1.json()
    expect(baru.refresh_token).not.toBe(awal.refresh_token)
  })

  it('pemakaian ulang refresh token mencabut seluruh keluarga sesi', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body: awal } = await login(t, 'admin@x.id')
    const baru = await (await t.call('/auth/refresh', { refresh_token: awal.refresh_token })).json()

    // Penyerang memakai ulang token lama yang sudah dirotasi.
    const serangan = await t.call('/auth/refresh', { refresh_token: awal.refresh_token })
    expect(serangan.status).toBe(401)

    // Akibatnya token sah milik pengguna pun ikut dicabut: lebih baik
    // memaksa login ulang daripada membiarkan sesi yang mungkin dibajak.
    const setelah = await t.call('/auth/refresh', { refresh_token: baru.refresh_token })
    expect(setelah.status).toBe(401)
  })

  it('logout mencabut sesi', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body } = await login(t, 'admin@x.id')
    expect((await t.call('/auth/logout', { refresh_token: body.refresh_token })).status).toBe(204)
    expect((await t.call('/auth/refresh', { refresh_token: body.refresh_token })).status).toBe(401)
  })

  it('refresh token palsu ditolak', async () => {
    const t = setup()
    expect((await t.call('/auth/refresh', { refresh_token: 'ngawur' })).status).toBe(401)
  })

  it('refresh token tidak disimpan polos', async () => {
    const t = setup()
    await adminTerdaftar(t)
    const { body } = await login(t, 'admin@x.id')
    const sesi = await t.repo.findSessionByTokenHash(body.refresh_token)
    // Mencari dengan token mentah harus gagal: yang tersimpan adalah hash-nya.
    expect(sesi).toBeUndefined()
  })
})

describe('keamanan access token', () => {
  it('token kedaluwarsa ditolak', () => {
    const { token } = issueAccessToken('u1', 'auditor', Date.parse('2026-01-01T00:00:00Z'))
    expect(verifyAccessToken(token, Date.parse('2026-01-01T00:10:00Z'))).not.toBeNull()
    expect(verifyAccessToken(token, Date.parse('2026-01-01T00:16:00Z'))).toBeNull()
  })

  it('tanda tangan yang diubah ditolak', () => {
    const { token } = issueAccessToken('u1', 'auditor')
    const [h, p] = token.split('.')
    expect(verifyAccessToken(`${h}.${p}.tandatanganpalsu`)).toBeNull()
  })

  it('payload yang diubah ditolak', () => {
    const { token } = issueAccessToken('u1', 'auditor')
    const [h, , s] = token.split('.')
    const jahat = Buffer.from(JSON.stringify({
      sub: 'korban', role: 'sysadmin', iat: 0, exp: 9e9,
    })).toString('base64url')
    expect(verifyAccessToken(`${h}.${jahat}.${s}`)).toBeNull()
  })

  it('serangan alg=none ditolak', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      sub: 'korban', exp: 9e9, iat: 0,
    })).toString('base64url')
    expect(verifyAccessToken(`${header}.${payload}.`)).toBeNull()
  })

  it('token asal-asalan tidak membuat crash', () => {
    for (const buruk of ['', 'a', 'a.b', 'a.b.c.d', '...', 'x'.repeat(500)]) {
      expect(verifyAccessToken(buruk)).toBeNull()
    }
  })
})

describe('token pengembangan hanya aktif bila diizinkan', () => {
  /**
   * Uji ini mengubah variabel lingkungan proses. Bun menjalankan seluruh berkas
   * uji dalam satu proses, sehingga nilai semula WAJIB dipulihkan; bila tidak,
   * berkas uji lain yang mengandalkan ALLOW_DEV_TOKENS akan ikut gagal.
   */
  const jalankanDengan = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
    const semula: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      semula[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      return fn()
    } finally {
      for (const [k, v] of Object.entries(semula)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  it('ditolak saat ALLOW_DEV_TOKENS tidak disetel', () => {
    jalankanDengan({ ALLOW_DEV_TOKENS: undefined }, () => {
      expect(parseBearer('Bearer user:abc123')).toBeNull()
    })
  })

  it('diterima hanya saat ALLOW_DEV_TOKENS=1', () => {
    jalankanDengan({ ALLOW_DEV_TOKENS: '1' }, () => {
      expect(parseBearer('Bearer user:abc123')?.id).toBe('abc123')
    })
  })

  it('tidak pernah aktif di produksi, walau diizinkan', () => {
    jalankanDengan({ NODE_ENV: 'production', ALLOW_DEV_TOKENS: '1' }, () => {
      expect(parseBearer('Bearer user:abc123')).toBeNull()
    })
  })

  it('endpoint terlindungi menolak token pengembangan saat tidak diizinkan', async () => {
    const t = setup()
    const a = await adminTerdaftar(t)
    const semula = process.env.ALLOW_DEV_TOKENS
    delete process.env.ALLOW_DEV_TOKENS
    try {
      const res = await t.call('/auth/me', undefined, { authorization: `Bearer user:${a.id}` })
      expect(res.status).toBe(401)
    } finally {
      if (semula !== undefined) process.env.ALLOW_DEV_TOKENS = semula
    }
  })
})

describe('FR-02 login kata sandi', () => {
  /** Akun dengan kata sandi yang sudah ditetapkan. */
  async function akunBerkataSandi(t: ReturnType<typeof setup>, password = 'kataSandiPanjang1') {
    const a = await t.repo.createAuditor({
      email: 'pass@x.id', name: 'Pass', role: 'auditor',
      password_hash: hashPassword(password),
    })
    return a
  }

  it('menerbitkan sesi untuk kata sandi yang benar', async () => {
    const t = setup()
    await akunBerkataSandi(t)
    const res = await t.call('/auth/login', { email: 'pass@x.id', password: 'kataSandiPanjang1' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(verifyAccessToken(body.access_token)?.sub).toBeString()
    expect(body.refresh_token).toBeString()
  })

  it('email tidak dikenal dan kata sandi salah menghasilkan respons identik', async () => {
    const t = setup()
    await akunBerkataSandi(t)
    const salah = await t.call('/auth/login', { email: 'pass@x.id', password: 'salah-sekali' })
    const asing = await t.call('/auth/login', { email: 'hantu@x.id', password: 'salah-sekali' })
    expect(salah.status).toBe(401)
    expect(asing.status).toBe(401)
    // trace_id sengaja berbeda per permintaan; kode dan pesannya yang harus sama.
    const a = (await salah.json()).error
    const b = (await asing.json()).error
    expect([a.code, a.message]).toEqual([b.code, b.message])
  })

  it('akun tanpa kata sandi tidak bisa ditembus dengan kata sandi kosong', async () => {
    const t = setup()
    await t.repo.createAuditor({ email: 'kosong@x.id', name: 'K', role: 'auditor' })
    const res = await t.call('/auth/login', { email: 'kosong@x.id', password: ' ' })
    expect(res.status).toBe(401)
  })

  it('email tidak peka huruf besar-kecil', async () => {
    const t = setup()
    await akunBerkataSandi(t)
    const res = await t.call('/auth/login', { email: 'PASS@X.ID', password: 'kataSandiPanjang1' })
    expect(res.status).toBe(200)
  })

  it('sesi hasil login dapat memakai refresh token seperti jalur OTP', async () => {
    const t = setup()
    await akunBerkataSandi(t)
    const masuk = await (await t.call('/auth/login',
      { email: 'pass@x.id', password: 'kataSandiPanjang1' })).json()
    const res = await t.call('/auth/refresh', { refresh_token: masuk.refresh_token })
    expect(res.status).toBe(200)
  })
})

describe('FR-02 penetapan kata sandi', () => {
  /** Access token sungguhan lewat jalur OTP; file uji ini tidak memakai token pintasan. */
  async function sesi(t: ReturnType<typeof setup>, email: string) {
    const { body } = await login(t, email)
    return { authorization: `Bearer ${body.access_token}` }
  }

  it('auditor tanpa kata sandi dapat menetapkannya lalu login', async () => {
    const t = setup()
    await t.repo.createAuditor({ email: 'baru@x.id', name: 'Baru', role: 'auditor' })
    const set = await t.call('/auth/password', { new_password: 'rahasiaPanjang123' },
      await sesi(t, 'baru@x.id'))
    expect(set.status).toBe(204)
    const login = await t.call('/auth/login', { email: 'baru@x.id', password: 'rahasiaPanjang123' })
    expect(login.status).toBe(200)
  })

  it('mengganti kata sandi menuntut kata sandi lama', async () => {
    const t = setup()
    await t.repo.createAuditor({
      email: 'ganti@x.id', name: 'G', role: 'auditor',
      password_hash: hashPassword('lamaPanjangSekali'),
    })
    const h = await sesi(t, 'ganti@x.id')
    const tanpa = await t.call('/auth/password', { new_password: 'baruPanjangSekali' }, h)
    expect(tanpa.status).toBe(401)

    const dengan = await t.call('/auth/password',
      { current_password: 'lamaPanjangSekali', new_password: 'baruPanjangSekali' }, h)
    expect(dengan.status).toBe(204)
  })

  it('menolak kata sandi yang terlalu pendek', async () => {
    const t = setup()
    await t.repo.createAuditor({ email: 'pendek@x.id', name: 'P', role: 'auditor' })
    const res = await t.call('/auth/password', { new_password: 'abc' },
      await sesi(t, 'pendek@x.id'))
    expect(res.status).toBe(422)
  })
})

describe('hashing kata sandi', () => {
  it('hash berbeda untuk kata sandi sama, karena salt acak', () => {
    expect(hashPassword('kataSandiPanjang1')).not.toBe(hashPassword('kataSandiPanjang1'))
  })

  it('kata sandi tidak pernah muncul dalam hash', () => {
    expect(hashPassword('kataSandiPanjang1')).not.toContain('kataSandiPanjang1')
  })

  it('verifikasi menolak hash yang rusak atau kosong tanpa melempar', () => {
    expect(verifyPassword('apa saja', undefined)).toBe(false)
    expect(verifyPassword('apa saja', 'bukan-format-hash')).toBe(false)
    expect(verifyPassword('apa saja', 'scrypt$$')).toBe(false)
  })

  it('kata sandi setara Unicode dinormalkan sehingga tetap cocok', () => {
    // "é" dapat ditulis sebagai satu atau dua titik kode; keyboard berbeda
    // menghasilkan byte berbeda untuk kata sandi yang sama bagi pengguna.
    const h = hashPassword('sandiKu\u00e9Panjang')
    expect(verifyPassword('sandiKue\u0301Panjang', h)).toBe(true)
  })
})
