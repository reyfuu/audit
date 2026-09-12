/**
 * Demo lokal SiapAI.
 *
 * Menjalankan API, form responden, dan dashboard auditor dalam satu proses,
 * lengkap dengan akun demo dan tiga perusahaan contoh pada kondisi berbeda,
 * sehingga alur dapat dicoba tanpa persiapan apa pun.
 *
 * Jalankan: bun run demo:lokal
 */
import { QUESTIONNAIRE_V1 as QN, type Question } from '@siapai/scoring'
import { createApp } from '../../api/src/app'
import { createStorage } from '../../api/src/db'
import { createWeb } from '../src/web'
import { auditorModule } from '../src/auditor'
import { Elysia } from 'elysia'

const API_PORT = Number(process.env.API_PORT ?? 3001)
const WEB_PORT = Number(process.env.PORT ?? 3000)
const WEB_BASE = process.env.PUBLIC_BASE_URL ?? `http://localhost:${WEB_PORT}`

// Postgres bila DATABASE_URL ada, selain itu memori.
const storage = createStorage()
const { app: api, repo } = createApp({ repo: storage.repo, baseUrl: WEB_BASE })
api.listen(API_PORT)

// ── Akun demo; dipakai ulang bila sudah ada agar restart tidak menggandakan.
const auditor = await ambilAtauBuatAuditor()

async function ambilAtauBuatAuditor() {
  const email = 'auditor@demo.id'
  if (storage.kind === 'postgres') {
    const { db, client } = await import('../../api/src/db/pg-repo')
      .then(async (m) => m.createDb(process.env.DATABASE_URL!, { max: 1 }))
    const s = await import('../../api/src/db/schema')
    const { eq } = await import('drizzle-orm')
    const [ada] = await db.select().from(s.auditors).where(eq(s.auditors.email, email))
    await client.end()
    if (ada) return { id: ada.id, email: ada.email, name: ada.name, role: ada.role }
  }
  return repo.createAuditor({ email, name: 'Dimas Auditor', role: 'auditor_admin' })
}

/** Pemanggil API untuk dashboard; identitas auditor demo disuntikkan di sini. */
const callApi = (path: string, init: RequestInit = {}) =>
  api.handle(new Request(`http://localhost:${API_PORT}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer user:${auditor.id}` },
  }))

/** Pemanggil API untuk form responden; tanpa kredensial, sesuai model token. */
const callPublic = (path: string, init?: RequestInit) =>
  api.handle(new Request(`http://localhost:${API_PORT}${path}`, init))

new Elysia()
  .get('/', () => new Response(null, { status: 303, headers: { location: '/app' } }))
  .use(auditorModule({ api: callApi, publicBase: WEB_BASE }))
  .use(createWeb({ api: callPublic }))
  .listen(WEB_PORT)

// ── Tiga perusahaan contoh dengan kondisi berbeda
async function issue(companyId: string, recipient: string) {
  const r = await callApi('/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, recipient_name: recipient }),
  })
  return await r.json() as { id: string; token: string; invitation_url: string }
}

/**
 * Memilih jawaban untuk profil demo.
 *
 * Sengaja TIDAK memakai opsi terendah untuk semua pertanyaan: UMKM nyata yang
 * masih memakai spreadsheet tetap punya sebagian hal yang berjalan, sehingga
 * skor 0/100 akan terasa palsu dan membuat laporan demo tidak meyakinkan.
 * Profil 'rintisan' mengambil kisaran bawah tetapi bervariasi per dimensi.
 */
const pilih = (q: Question, tingkat: 'rintisan' | 'sedang' | 'tinggi') => {
  // Dimensi yang biasanya paling tertinggal pada UMKM: data dan tata kelola.
  const tertinggal = q.dimension_code === 'DAT' || q.dimension_code === 'GOV'
  switch (q.type) {
    case 'single_choice': {
      const s = [...(q.options ?? [])].sort((a, b) => a.score - b.score)
      const last = s.length - 1
      const idx =
        tingkat === 'tinggi' ? last
        : tingkat === 'sedang' ? Math.round(last * 0.6)
        : tertinggal ? Math.min(1, last)          // rintisan: nyaris nol di data & tata kelola
        : Math.round(last * 0.35)                  // tetapi tidak nol di dimensi lain
      return { choice: s[idx]!.code }
    }
    case 'multi_choice': {
      const o = q.options ?? []
      const rasio = tingkat === 'tinggi' ? 1 : tingkat === 'sedang' ? 0.6 : 0.3
      const n = Math.max(1, Math.round(o.length * rasio))
      return { choices: o.slice(0, n).map((x: { code: string }) => x.code) }
    }
    case 'scale_1_5':
      return { scale: tingkat === 'tinggi' ? 5 : tingkat === 'sedang' ? 4 : 2 }
    case 'boolean':
      return { bool: tingkat === 'tinggi' }
    case 'number':
      return { number: tingkat === 'rintisan' ? (q.min ?? 0) : (q.max ?? 100) }
    default:
      return { text: '' }
  }
}

/** Mengisi form sampai tuntas, meniru responden sungguhan. */
async function isiPenuh(token: string, tingkat: 'rintisan' | 'sedang' | 'tinggi') {
  for (let i = 0; i < 60; i++) {
    const s = await (await callPublic(`/f/${token}/next`)).json()
    const sudah = new Set(s.answers.map((a: { question_code: string }) => a.question_code))
    const kurang = (s.questions as Question[]).filter((q) => !sudah.has(q.code))
    if (kurang.length === 0) {
      const rev = await (await callPublic(`/f/${token}/review`)).json()
      if (rev.missing.length === 0) break
      const kode = rev.missing[0] as string
      const dim = QN.questions.find((q) => q.code === kode)!.dimension_code
      const sec = await (await callPublic(`/f/${token}/next?section=${dim}`)).json()
      await callPublic(`/f/${token}/answers`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: (sec.questions as Question[])
            .filter((q) => rev.missing.includes(q.code))
            .map((q) => ({ question_code: q.code, value: pilih(q, tingkat) })),
        }),
      })
      continue
    }
    await callPublic(`/f/${token}/answers`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: kurang.map((q) => ({ question_code: q.code, value: pilih(q, tingkat) })),
      }),
    })
  }
}

const mk = (name: string, industry: string, band: string) =>
  repo.createCompany({
    owner_auditor_id: auditor.id, name,
    industry: industry as never, employee_band: band as never, country: 'ID',
  })

// 1. Belum diisi sama sekali: untuk dicoba sendiri dari HP.
const baru = await mk('PT Maju Jaya Retail', 'retail_ecommerce', '50_99')
const invBaru = await issue(baru.id, 'Pak Budi')

// 2. Sedang diisi separuh: memperlihatkan status IN_PROGRESS di dashboard.
const separuh = await mk('CV Sinar Terang Logistik', 'logistics', '10_49')
const invSeparuh = await issue(separuh.id, 'Bu Sari')
{
  const s = await (await callPublic(`/f/${invSeparuh.token}/next`)).json()
  await callPublic(`/f/${invSeparuh.token}/answers`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: (s.questions as Question[]).map((q) => ({ question_code: q.code, value: pilih(q, 'sedang') })),
    }),
  })
}

// 3. Sudah selesai dengan kondisi lemah: laporannya langsung dapat dilihat.
const selesai = await mk('Toko Berkah Sentosa', 'fnb', '10_49')
const invSelesai = await issue(selesai.id, 'Pak Hendra')
await isiPenuh(invSelesai.token, 'rintisan')
const hasil = await (await callPublic(`/f/${invSelesai.token}/submit`, { method: 'POST' })).json()

const garis = '─'.repeat(64)
console.log(`
${garis}
  SiapAI — demo lokal siap dipakai
${garis}

  AKUN DEMO
    Auditor   : ${auditor.name} <${auditor.email}>
    Catatan   : autentikasi nyata belum dipasang (FR-01..FR-04).
                Sesi auditor sudah aktif otomatis di dashboard demo ini.

  BUKA DASHBOARD AUDITOR
    ${WEB_BASE}/app

  COBA ISI FORM SENDIRI (belum diisi)
    Perusahaan: ${baru.name}
    Tautan    : ${invBaru.invitation_url}
    QR        : buka ${WEB_BASE}/app/undangan/${invBaru.id}

  CONTOH SEDANG DIISI
    ${separuh.name} — lihat statusnya di dashboard

  CONTOH SUDAH SELESAI (laporan langsung bisa dilihat)
    ${selesai.name}
    Skor ${hasil.total_score}/100 · ${hasil.verdict}
    Laporan   : ${WEB_BASE}/f/${invSelesai.token}/hasil

  MENCOBA DARI HP
    1. Buka ${WEB_BASE}/app/undangan/${invBaru.id} di laptop
    2. Pindai QR yang tampil memakai kamera HP
    3. Pastikan HP satu jaringan Wi-Fi dengan laptop, lalu jalankan ulang dengan:
       PUBLIC_BASE_URL=http://<IP-laptop>:${WEB_PORT} bun run demo:lokal

  Penyimpanan: ${storage.kind === 'postgres'
    ? 'PostgreSQL — data bertahan setelah proses dihentikan.'
    : 'memori — data hilang saat proses dihentikan.\n                Untuk persisten: DATABASE_URL=postgres://localhost:5432/siapai_dev bun run demo:lokal'}

  Ctrl+C untuk berhenti.
${garis}
`)
