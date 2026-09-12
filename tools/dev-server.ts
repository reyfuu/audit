/**
 * Menjalankan API dan web dalam satu proses, lengkap dengan data contoh.
 * Untuk mencoba alur nyata: terbitkan undangan, buka QR, isi form.
 *
 * Jalankan: bun tools/dev-server.ts
 */
import { createApp } from '../apps/api/src/app'
import { createWeb } from '../apps/web/src/web'

const API_PORT = 3001
const WEB_PORT = 3000
const WEB_BASE = `http://localhost:${WEB_PORT}`

const { app: api, repo } = createApp({ baseUrl: WEB_BASE })
api.listen(API_PORT)

createWeb({
  api: (path, init) => api.handle(new Request(`http://localhost:${API_PORT}${path}`, init)),
}).listen(WEB_PORT)

// ── Data contoh
const auditor = repo.createAuditor({
  email: 'dimas@siapai.id', name: 'Dimas Auditor', role: 'auditor',
})
const company = repo.createCompany({
  owner_auditor_id: auditor.id,
  name: 'PT Maju Jaya Retail',
  industry: 'retail_ecommerce',
  employee_band: '50_99',
  country: 'ID',
  province: 'Jawa Barat',
})

const res = await api.handle(new Request(`http://localhost:${API_PORT}/invitations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer user:${auditor.id}` },
  body: JSON.stringify({ company_id: company.id, recipient_name: 'Pak Budi' }),
}))
const inv = await res.json() as {
  id: string; token: string; invitation_url: string
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  SiapAI berjalan                                             ║
╚══════════════════════════════════════════════════════════════╝

  Perusahaan   : ${company.name}
  Auditor      : ${auditor.name}

  FORM (buka ini, atau pindai QR-nya dari HP):
  ${inv.invitation_url}

  QR code untuk dipindai:
  http://localhost:${API_PORT}/invitations/${inv.id}/qr.png
  (perlu header: Authorization: Bearer user:${auditor.id})

  API          : http://localhost:${API_PORT}
  Web          : ${WEB_BASE}

  Tekan Ctrl+C untuk berhenti.
`)
