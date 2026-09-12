/**
 * Dashboard auditor sederhana untuk demo lokal (FR-29).
 *
 * Sengaja server-rendered dan seragam dengan form responden, sehingga auditor
 * dapat menerbitkan undangan, melihat QR, dan memantau status tanpa alat lain.
 */
import { Elysia, t } from 'elysia'
import { STYLES } from './styles'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export interface AuditorDeps {
  /** Pemanggil API yang sudah membawa identitas auditor demo. */
  api: (path: string, init?: RequestInit) => Promise<Response>
  /** Basis URL publik untuk menyusun tautan form. */
  publicBase: string
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Terkirim', OPENED: 'Sudah dibuka', IN_PROGRESS: 'Sedang diisi',
  SUBMITTED: 'Terkirim balik', SCORED: 'Selesai', REVOKED: 'Dicabut', EXPIRED: 'Kedaluwarsa',
}
/** Label industri dalam bahasa manusia; nilai mentah seperti `fnb` membingungkan. */
const INDUSTRI_LABEL: Record<string, string> = {
  retail_ecommerce: 'Retail & e-commerce',
  manufacturing: 'Manufaktur',
  fnb: 'Makanan & minuman',
  logistics: 'Logistik',
  financial_services: 'Jasa keuangan',
  healthcare: 'Kesehatan',
  education: 'Pendidikan',
  professional_services: 'Jasa profesional',
  construction_property: 'Konstruksi & properti',
  agriculture: 'Pertanian',
  media_creative: 'Media & kreatif',
  technology: 'Teknologi',
  government_public: 'Pemerintahan & publik',
  other: 'Lainnya',
}

const KARYAWAN_LABEL: Record<string, string> = {
  '1_9': '1–9 orang', '10_49': '10–49 orang', '50_99': '50–99 orang',
  '100_499': '100–499 orang', '500_999': '500–999 orang', '1000_plus': '1000 orang atau lebih',
}

const STATUS_COLOR: Record<string, string> = {
  SENT: 'var(--muted)', OPENED: 'var(--brand-600)', IN_PROGRESS: 'var(--warn)',
  SUBMITTED: 'var(--ok)', SCORED: 'var(--ok)', REVOKED: 'var(--danger)', EXPIRED: 'var(--danger)',
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLES}
.tbl { width:100%; border-collapse:collapse; }
.tbl th { text-align:left; font-size:13px; color:var(--muted); font-weight:600;
  padding:8px 4px; border-bottom:1px solid var(--border); }
.tbl td { padding:12px 4px; border-bottom:1px solid var(--border); font-size:15px; vertical-align:top; }
.pill { display:inline-block; font-size:12px; font-weight:600; padding:3px 10px;
  border-radius:999px; border:1px solid currentColor; }
.qr { display:block; width:180px; height:180px; border:1px solid var(--border);
  border-radius:var(--radius); background:#fff; }
.copybox { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px;
  background:var(--bg); border:1px solid var(--border); border-radius:6px;
  padding:10px; word-break:break-all; margin:8px 0; }
.grid { display:grid; gap:16px; }
@media (min-width:768px) { .grid-2 { grid-template-columns:1fr 1fr; } }
.wrap-wide { max-width:960px; margin:0 auto; padding:16px 16px 48px; }
</style></head><body>
<header class="bar">
  <a href="/app" style="text-decoration:none"><span class="brand">SiapAI</span></a>
  <span class="save" style="color:var(--muted)">Dashboard auditor</span>
</header>
${body}
</body></html>`
}

export function auditorModule({ api, publicBase }: AuditorDeps) {
  return new Elysia()
    // ── Daftar undangan (FR-29)
    .get('/app', async () => {
      const [invRes, compRes] = await Promise.all([api('/invitations'), api('/companies')])
      const { items } = await invRes.json() as { items: Invitation[] }
      const { items: companies } = await compRes.json() as { items: Company[] }

      const rows = items.length === 0
        ? `<tr><td colspan="4" class="muted" style="padding:24px 4px">
             Belum ada undangan. Terbitkan satu di bawah.</td></tr>`
        : items.map((i) => `<tr>
            <td>
              <strong>${esc(i.company_name)}</strong><br>
              <span class="muted">${esc(i.recipient_name ?? 'Tanpa nama penerima')}</span>
            </td>
            <td><span class="pill" style="color:${STATUS_COLOR[i.status]}">
              ${esc(STATUS_LABEL[i.status] ?? i.status)}</span></td>
            <td>
              ${i.progress.answered}/${i.progress.total_visible}
              <div class="progress" style="margin-top:6px;width:110px">
                <i style="width:${i.progress.percent}%"></i>
              </div>
            </td>
            <td><a href="/app/undangan/${esc(i.id)}">Lihat QR</a></td>
          </tr>`).join('')

      const opts = companies.map((c) =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')

      return html(page('Dashboard auditor', `
<main class="wrap-wide">
  <h1>Undangan audit</h1>
  <p class="muted">Pantau siapa yang sudah mengisi, dan ambil QR untuk dibagikan.</p>
  <div class="card">
    <table class="tbl">
      <thead><tr><th>Perusahaan</th><th>Status</th><th>Progres</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Terbitkan undangan baru</h2>
    <form method="post" action="/app/undangan">
      <p><label for="c" class="muted">Perusahaan klien</label><br>
        <select name="company_id" id="c" style="width:100%;min-height:48px;font-size:16px;
          border:1px solid var(--border);border-radius:var(--radius);padding:0 12px">
          ${opts}
        </select></p>
      <p><label for="r" class="muted">Nama penerima (opsional)</label><br>
        <input name="recipient_name" id="r" placeholder="mis. Pak Budi"
          style="width:100%;min-height:48px;font-size:16px;border:1px solid var(--border);
          border-radius:var(--radius);padding:0 12px"></p>
      <button class="btn btn-primary" type="submit" style="max-width:280px">
        Terbitkan undangan</button>
    </form>
  </div>

  <div class="card">
    <h2>Tambah perusahaan klien</h2>
    <form method="post" action="/app/perusahaan">
      <p><label for="n" class="muted">Nama perusahaan</label><br>
        <input name="name" id="n" required placeholder="PT Contoh Sejahtera"
          style="width:100%;min-height:48px;font-size:16px;border:1px solid var(--border);
          border-radius:var(--radius);padding:0 12px"></p>
      <div class="grid grid-2">
        <p><label for="i" class="muted">Industri</label><br>
          <select name="industry" id="i" style="width:100%;min-height:48px;font-size:16px;
            border:1px solid var(--border);border-radius:var(--radius);padding:0 12px">
            ${Object.entries(INDUSTRI_LABEL)
              .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select></p>
        <p><label for="e" class="muted">Jumlah karyawan</label><br>
          <select name="employee_band" id="e" style="width:100%;min-height:48px;font-size:16px;
            border:1px solid var(--border);border-radius:var(--radius);padding:0 12px">
            ${Object.entries(KARYAWAN_LABEL)
              .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select></p>
      </div>
      <button class="btn" type="submit" style="max-width:280px">Tambah perusahaan</button>
    </form>
  </div>
</main>`))
    })

    // ── Detail undangan dengan QR siap pindai (FR-23, FR-24)
    .get('/app/undangan/:id', async ({ params }) => {
      const res = await api(`/invitations/${params.id}`)
      if (!res.ok) return html(page('Tidak ditemukan',
        `<main class="wrap-wide"><div class="card"><h1>Undangan tidak ditemukan</h1></div></main>`), 404)
      const inv = await res.json() as Invitation
      const link = (inv as Invitation & { invitation_url?: string }).invitation_url

      return html(page(`Undangan ${inv.company_name}`, `
<main class="wrap-wide">
  <p><a href="/app">← Kembali ke daftar</a></p>
  <h1>${esc(inv.company_name)}</h1>
  <p><span class="pill" style="color:${STATUS_COLOR[inv.status]}">
    ${esc(STATUS_LABEL[inv.status] ?? inv.status)}</span>
    <span class="muted"> · ${inv.progress.answered} dari ${inv.progress.total_visible} terjawab</span></p>

  <div class="grid grid-2">
    <div class="card">
      <h2>Pindai dari HP</h2>
      <p class="muted">Arahkan kamera HP ke kode ini untuk membuka form.</p>
      <img class="qr" alt="QR code undangan untuk ${esc(inv.company_name)}"
           src="/app/undangan/${esc(inv.id)}/qr.png">
    </div>
    <div class="card">
      <h2>Atau bagikan tautan</h2>
      ${link
        ? `<div class="copybox">${esc(link)}</div>
           <p><a class="btn btn-primary" href="${esc(link)}" target="_blank"
                 style="display:inline-block;line-height:48px;text-decoration:none;
                        text-align:center;max-width:260px">Buka form di tab ini</a></p>`
        : `<p class="muted">Tautan hanya ditampilkan sekali saat penerbitan.
             Gunakan QR di samping, atau terbitkan ulang untuk memperoleh tautan baru.</p>`}
      <form method="post" action="/app/undangan/${esc(inv.id)}/reissue" style="margin-top:16px">
        <button class="btn" type="submit" style="max-width:260px">Terbitkan ulang token</button>
      </form>
      <p class="muted" style="margin-top:12px">
        Berlaku sampai ${esc(new Date(inv.expires_at).toLocaleDateString('id-ID',
          { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
    </div>
  </div>

  ${inv.status === 'SCORED'
    ? `<div class="card"><h2>Hasil sudah tersedia</h2>
        <p class="muted">Responden telah mengirim jawaban dan laporan sudah dihitung.</p>
        ${link
          ? `<a class="btn btn-primary" href="${esc(link)}/hasil"
                style="display:inline-block;line-height:48px;text-decoration:none;
                       text-align:center;max-width:260px">Lihat laporan</a>`
          : `<p class="muted">Terbitkan ulang token untuk memperoleh tautan laporan.</p>`}
       </div>`
    : ''}
</main>`))
    }, { params: t.Object({ id: t.String() }) })

    // Proksi gambar QR agar dashboard tidak perlu menyematkan kredensial di HTML.
    .get('/app/undangan/:id/qr.png', async ({ params, set }) => {
      const res = await api(`/invitations/${params.id}/qr.png`)
      if (!res.ok) { set.status = 404; return 'not found' }
      set.headers['content-type'] = 'image/png'
      set.headers['cache-control'] = 'private, no-store'
      return new Response(await res.arrayBuffer())
    }, { params: t.Object({ id: t.String() }) })

    .post('/app/undangan', async ({ body }) => {
      const f = body as Record<string, string>
      const res = await api('/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company_id: f.company_id,
          ...(f.recipient_name ? { recipient_name: f.recipient_name } : {}),
        }),
      })
      if (!res.ok) {
        const e = await res.json() as { error: { message: string; details?: { invitation_id?: string } } }
        const id = e.error.details?.invitation_id
        // Sudah ada undangan aktif: arahkan ke sana, jangan buntu.
        return id ? redirect(`/app/undangan/${id}`) : html(page('Gagal',
          `<main class="wrap-wide"><div class="card">
             <h1>Tidak dapat menerbitkan</h1><p>${esc(e.error.message)}</p>
             <p><a href="/app">Kembali</a></p></div></main>`), 409)
      }
      const inv = await res.json() as { id: string }
      return redirect(`/app/undangan/${inv.id}`)
    })

    .post('/app/undangan/:id/reissue', async ({ params }) => {
      const res = await api(`/invitations/${params.id}/reissue`, { method: 'POST' })
      if (!res.ok) return redirect('/app')
      const inv = await res.json() as { id: string }
      return redirect(`/app/undangan/${inv.id}`)
    }, { params: t.Object({ id: t.String() }) })

    .post('/app/perusahaan', async ({ body }) => {
      const f = body as Record<string, string>
      await api('/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: f.name, industry: f.industry, employee_band: f.employee_band,
        }),
      })
      return redirect('/app')
    })
}

interface Invitation {
  id: string
  company_name: string
  status: string
  recipient_name?: string
  expires_at: string
  progress: { answered: number; total_visible: number; percent: number }
}
interface Company { id: string; name: string }

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store',
    },
  })

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } })
