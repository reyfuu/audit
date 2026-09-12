/**
 * Menyiapkan akun demo dan data contoh pada penyimpanan permanen.
 *
 * Berbeda dari `demo:lokal` yang membuat ulang segalanya di memori setiap kali
 * dijalankan, skrip ini idempoten: menjalankannya dua kali tidak menggandakan
 * perusahaan, dan kata sandi akun demo selalu dikembalikan ke nilai yang
 * tercetak di layar. Itu penting di server, tempat datanya bertahan.
 *
 * Jalankan: DATABASE_URL=postgres://... bun apps/web/demo/seed.ts
 */
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../../api/src/app'
import { createStorage } from '../../api/src/db'
import { hashPassword } from '../../api/src/lib/auth'

const EMAIL = process.env.DEMO_EMAIL ?? 'admin@example.com'
const SANDI = process.env.DEMO_PASSWORD ?? 'password123'
const BASE = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'

const storage = createStorage()
if (storage.kind !== 'postgres') {
  console.error('Seed hanya berguna pada penyimpanan permanen. Setel DATABASE_URL.')
  process.exit(1)
}

const { app: api, repo } = createApp({ repo: storage.repo, baseUrl: BASE })
const call = (path: string, init: RequestInit = {}, token?: string) =>
  api.handle(new Request(`http://127.0.0.1:3001${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }))

// ── Akun demo: dibuat sekali, kata sandinya selalu disetel ulang.
const ada = await repo.getAuditorByEmail(EMAIL)
const auditor = ada ?? await repo.createAuditor({
  email: EMAIL, name: 'Admin Auditor', role: 'auditor_admin',
  password_hash: hashPassword(SANDI),
})
if (ada) await repo.setAuditorPassword(ada.id, hashPassword(SANDI))

const token = await (async () => {
  const res = await call('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SANDI }),
  })
  if (!res.ok) throw new Error(`Login demo gagal: ${res.status}`)
  return (await res.json() as { access_token: string }).access_token
})()

/** Nilai jawaban untuk profil tertentu; lihat demo:lokal untuk alasannya. */
const pilih = (q: Question, tingkat: 'rintisan' | 'sedang' | 'tinggi') => {
  const tertinggal = q.dimension_code === 'DAT' || q.dimension_code === 'GOV'
  switch (q.type) {
    case 'single_choice': {
      const s = [...(q.options ?? [])].sort((a, b) => a.score - b.score)
      const last = s.length - 1
      const idx =
        tingkat === 'tinggi' ? last
        : tingkat === 'sedang' ? Math.round(last * 0.6)
        : tertinggal ? Math.min(1, last)
        : Math.round(last * 0.35)
      return { choice: s[idx]!.code }
    }
    case 'multi_choice': {
      const o = q.options ?? []
      const rasio = tingkat === 'tinggi' ? 1 : tingkat === 'sedang' ? 0.6 : 0.3
      return { choices: o.slice(0, Math.max(1, Math.round(o.length * rasio))).map((x) => x.code) }
    }
    case 'scale_1_5':
      return { scale: tingkat === 'tinggi' ? 5 : tingkat === 'sedang' ? 4 : 2 }
    case 'boolean': return { bool: tingkat === 'tinggi' }
    case 'number': return { number: tingkat === 'rintisan' ? (q.min ?? 0) : (q.max ?? 100) }
    default: return { text: '' }
  }
}

async function isiPenuh(t: string, tingkat: 'rintisan' | 'sedang' | 'tinggi') {
  for (let i = 0; i < 60; i++) {
    const s = await (await call(`/f/${t}/next`)).json() as {
      answers: { question_code: string }[]; questions: Question[]
    }
    const sudah = new Set(s.answers.map((a) => a.question_code))
    const kurang = s.questions.filter((q) => !sudah.has(q.code))
    if (kurang.length === 0) {
      const rev = await (await call(`/f/${t}/review`)).json() as { missing: string[] }
      if (rev.missing.length === 0) break
      const dim = QN.questions.find((q) => q.code === rev.missing[0])!.dimension_code
      const sec = await (await call(`/f/${t}/next?section=${dim}`)).json() as {
        questions: Question[]
      }
      await call(`/f/${t}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: sec.questions.filter((q) => rev.missing.includes(q.code))
            .map((q) => ({ question_code: q.code, value: pilih(q, tingkat) })),
        }),
      })
      continue
    }
    await call(`/f/${t}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: kurang.map((q) => ({ question_code: q.code, value: pilih(q, tingkat) })),
      }),
    })
  }
  await call(`/f/${t}/submit`, { method: 'POST' })
}

/** Perusahaan contoh; dilewati bila namanya sudah ada. */
const CONTOH = [
  { nama: 'PT Maju Jaya Retail', industry: 'retail_ecommerce', band: '50_99',
    penerima: 'Pak Budi', isi: 'kosong' },
  { nama: 'CV Sinar Terang Logistik', industry: 'logistics', band: '10_49',
    penerima: 'Bu Sari', isi: 'separuh' },
  { nama: 'Toko Berkah Sentosa', industry: 'fnb', band: '10_49',
    penerima: 'Pak Hendra', isi: 'penuh' },
  { nama: 'PT Anugerah Tekstil', industry: 'manufacturing', band: '100_499',
    penerima: 'Perwakilan', isi: 'kosong' },
  { nama: 'PT Nusantara Farma', industry: 'healthcare', band: '100_499',
    penerima: 'Perwakilan', isi: 'kosong' },
] as const

const sudahAda = new Set((await repo.listCompanies(auditor.id)).map((c) => c.name))
let dibuat = 0
let tautanContoh = ''

for (const c of CONTOH) {
  if (sudahAda.has(c.nama)) continue
  const company = await repo.createCompany({
    owner_auditor_id: auditor.id, name: c.nama,
    industry: c.industry as never, employee_band: c.band as never, country: 'ID',
  })
  const inv = await (await call('/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company_id: company.id, recipient_name: c.penerima }),
  }, token)).json() as { token: string; invitation_url: string }
  dibuat += 1
  if (c.isi === 'kosong' && !tautanContoh) tautanContoh = inv.invitation_url

  if (c.isi === 'separuh') {
    const s = await (await call(`/f/${inv.token}/next`)).json() as { questions: Question[] }
    await call(`/f/${inv.token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: s.questions.map((q) => ({ question_code: q.code, value: pilih(q, 'sedang') })),
      }),
    })
  }
  if (c.isi === 'penuh') await isiPenuh(inv.token, 'rintisan')
}

const total = (await repo.listCompanies(auditor.id)).length
await storage.close()

const garis = '─'.repeat(60)
console.log(`
${garis}
  Seed selesai
${garis}
  Masuk      : ${BASE}
  Email      : ${EMAIL}
  Kata sandi : ${SANDI}

  Perusahaan : ${total} total, ${dibuat} baru dibuat kali ini
  ${tautanContoh ? `Form contoh: ${tautanContoh}` : ''}

  Menjalankan ulang skrip ini aman: perusahaan yang sudah ada dilewati,
  dan kata sandi akun demo disetel ulang ke nilai di atas.
${garis}
`)
