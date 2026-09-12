/**
 * Dashboard auditor (FR-29).
 *
 * Navigasi berbentuk sidebar dengan halaman terpisah untuk ringkasan, undangan,
 * perusahaan, dan tinjauan AI. Dipecah begini karena jumlah perusahaan bisa
 * ratusan: satu halaman panjang berisi semua formulir menjadi tidak terpakai
 * begitu daftarnya bertambah.
 *
 * Tetap server-rendered dengan form HTML biasa, seragam dengan form responden.
 */
import { Elysia, t } from 'elysia'
import { sessionPlugin, type RawApi, type AuthedApi } from './auth-guard'
import { ICONS } from './icons'
import { esc, html, redirect, shell } from './shell'

export interface AuditorDeps {
  /** Pemanggil API mentah; token sesi disuntikkan per permintaan. */
  raw: RawApi
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

const SEV_LABEL: Record<string, string> = {
  high: 'Perlu segera', medium: 'Perlu dicek', low: 'Catatan',
}

/** Jumlah baris per halaman; daftar ratusan perusahaan tidak dirender sekaligus. */
const PER_PAGE = 25

export function auditorModule({ raw, publicBase }: AuditorDeps) {
  return new Elysia()
    .use(sessionPlugin({ raw, publicBase }))

    // ── Ringkasan: apa yang perlu dikerjakan hari ini
    .get('/app', async ({ sesi }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const { api, cookiesBaru } = s
      const [me, invitations] = await Promise.all([profil(api), daftarUndangan(api)])

      const hitung = (f: (i: Invitation) => boolean) => invitations.filter(f).length
      const selesai = hitung((i) => i.status === 'SCORED')
      const berjalan = hitung((i) => ['SENT', 'OPENED', 'IN_PROGRESS'].includes(i.status))
      const belumDibuka = hitung((i) => i.status === 'SENT')
      const macet = invitations.filter((i) =>
        i.status === 'IN_PROGRESS' && i.progress.percent < 50)

      const terbaru = invitations.slice(0, 8)

      return html(shell({
        title: 'Ringkasan — SiapAI', active: '/app', ...(me ? { email: me.email } : {}),
        body: `
<div class="page-head"><h1>Ringkasan</h1>
  <span class="spacer"></span>
  <a class="btn btn-primary btn-sm btn-icon" href="/app/undangan"
     style="text-decoration:none">${ICONS.tambah}Terbitkan undangan</a>
</div>
<div class="stats">
  ${stat(ICONS.undangan, invitations.length, 'Total undangan')}
  ${stat(ICONS.ulang, berjalan, 'Sedang berjalan')}
  ${stat(ICONS.awas, belumDibuka, 'Belum dibuka', belumDibuka > 0 ? 'warn' : '')}
  ${stat(ICONS.ok, selesai, 'Laporan siap', selesai > 0 ? 'ok' : '')}
</div>

${macet.length ? `<div class="card">
  <h2>Perlu ditindaklanjuti</h2>
  <p class="muted">Sudah mulai mengisi tetapi berhenti di bawah setengah jalan.</p>
  <table class="tbl"><tbody>
    ${macet.slice(0, 6).map((i) => `<tr>
      <td><a href="/app/undangan/${esc(i.id)}">${esc(i.company_name)}</a></td>
      <td data-l="Progres" class="kol-progres">
        <span style="display:block">
          ${i.progress.answered}/${i.progress.total_visible} terjawab
          <div class="progress" style="margin-top:6px;width:120px;margin-left:auto">
            <i style="width:${i.progress.percent}%"></i>
          </div>
        </span>
      </td>
    </tr>`).join('')}
  </tbody></table>
</div>` : ''}

<div class="card">
  <h2>Aktivitas terbaru</h2>
  ${terbaru.length === 0
    ? `<p class="muted">Belum ada undangan. Mulai dengan menambah perusahaan klien,
         lalu terbitkan undangan.</p>
       <p><a class="btn btn-primary btn-sm" href="/app/perusahaan"
             style="display:inline-block;line-height:44px;text-decoration:none">
         Tambah perusahaan</a></p>`
    : `<table class="tbl">
        <thead><tr><th>Perusahaan</th><th>Status</th><th>Progres</th><th></th></tr></thead>
        <tbody>${terbaru.map(barisUndangan).join('')}</tbody>
       </table>`}
</div>`,
      }), 200, cookiesBaru)
    })

    // ── Daftar undangan + penerbitan
    .get('/app/undangan', async ({ sesi, query }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const { api, cookiesBaru } = s
      const [me, semua, companies] = await Promise.all([
        profil(api), daftarUndangan(api), daftarPerusahaan(api),
      ])

      const cari = (query.q ?? '').trim().toLowerCase()
      const status = query.status ?? ''
      const tersaring = semua.filter((i) =>
        (!cari || i.company_name.toLowerCase().includes(cari)
          || (i.recipient_name ?? '').toLowerCase().includes(cari))
        && (!status || i.status === status))
      const halaman = Math.max(1, Number(query.page ?? '1') || 1)
      const mulai = (halaman - 1) * PER_PAGE
      const potongan = tersaring.slice(mulai, mulai + PER_PAGE)

      const opts = companies.map((c) =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')

      return html(shell({
        title: 'Undangan — SiapAI', active: '/app/undangan', ...(me ? { email: me.email } : {}),
        body: `
<div class="page-head"><h1>Undangan audit</h1></div>

<form class="toolbar" method="get" action="/app/undangan">
  <input class="field" type="search" name="q" value="${esc(query.q ?? '')}"
         placeholder="Cari perusahaan atau penerima" style="flex:1;min-width:200px">
  <select class="field" name="status">
    <option value="">Semua status</option>
    ${Object.entries(STATUS_LABEL).map(([v, l]) =>
      `<option value="${v}"${status === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
  </select>
  <button class="btn btn-sm btn-icon" type="submit">${ICONS.cari}Saring</button>
</form>

<div class="card">
  <table class="tbl">
    <thead><tr><th>Perusahaan</th><th>Status</th><th>Progres</th><th></th></tr></thead>
    <tbody>${potongan.length === 0
      ? `<tr><td colspan="4" class="muted" style="padding:24px 6px">
           ${semua.length === 0
             ? 'Belum ada undangan. Terbitkan satu di bawah.'
             : 'Tidak ada undangan yang cocok dengan saringan ini.'}</td></tr>`
      : potongan.map(barisUndangan).join('')}</tbody>
  </table>
  ${paginasi('/app/undangan', query as Record<string, string>, halaman, tersaring.length)}
</div>

<div class="card">
  <h2>Terbitkan undangan baru</h2>
  ${companies.length === 0
    ? `<p class="muted">Belum ada perusahaan klien.
         <a href="/app/perusahaan">Tambahkan dulu satu perusahaan</a>.</p>`
    : `<form method="post" action="/app/undangan">
        <div class="grid grid-2">
          <div>
            <label class="lbl" for="c">Perusahaan klien</label>
            <select class="field" name="company_id" id="c" style="width:100%">${opts}</select>
          </div>
          <div>
            <label class="lbl" for="r">Nama penerima (opsional)</label>
            <input class="field" name="recipient_name" id="r" placeholder="mis. Pak Budi"
                   style="width:100%">
          </div>
        </div>
        <button class="btn btn-primary btn-sm btn-icon" type="submit" style="margin-top:14px">
          ${ICONS.tambah}Terbitkan undangan</button>
      </form>`}
</div>`,
      }), 200, cookiesBaru)
    }, {
      query: t.Object({
        q: t.Optional(t.String()), status: t.Optional(t.String()), page: t.Optional(t.String()),
      }),
    })

    // ── Daftar & penambahan perusahaan
    .get('/app/perusahaan', async ({ sesi, query }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const { api, cookiesBaru } = s
      const [me, companies, invitations] = await Promise.all([
        profil(api), daftarPerusahaan(api), daftarUndangan(api),
      ])
      const undanganPer = new Map(invitations.map((i) => [i.company_id, i]))

      const cari = (query.q ?? '').trim().toLowerCase()
      const tersaring = cari
        ? companies.filter((c) => c.name.toLowerCase().includes(cari))
        : companies
      const halaman = Math.max(1, Number(query.page ?? '1') || 1)
      const potongan = tersaring.slice((halaman - 1) * PER_PAGE, halaman * PER_PAGE)

      return html(shell({
        title: 'Perusahaan — SiapAI', active: '/app/perusahaan', ...(me ? { email: me.email } : {}),
        body: `
<div class="page-head"><h1>Perusahaan klien</h1>
  <span class="spacer"></span>
  <span class="muted" style="line-height:44px">${companies.length} terdaftar</span>
</div>

<form class="toolbar" method="get" action="/app/perusahaan">
  <input class="field" type="search" name="q" value="${esc(query.q ?? '')}"
         placeholder="Cari nama perusahaan" style="flex:1;min-width:200px">
  <button class="btn btn-sm btn-icon" type="submit">${ICONS.cari}Cari</button>
</form>

<div class="card">
  <table class="tbl">
    <thead><tr><th>Nama</th><th>Industri</th><th>Karyawan</th><th>Undangan</th></tr></thead>
    <tbody>${potongan.length === 0
      ? `<tr><td colspan="4" class="muted" style="padding:24px 6px">
           Belum ada perusahaan yang cocok.</td></tr>`
      : potongan.map((c) => {
          const inv = undanganPer.get(c.id)
          return `<tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td data-l="Industri">${esc(INDUSTRI_LABEL[c.industry] ?? c.industry)}</td>
            <td data-l="Karyawan">${esc(KARYAWAN_LABEL[c.employee_band] ?? c.employee_band)}</td>
            <td data-l="Undangan">${inv
              ? `<a href="/app/undangan/${esc(inv.id)}">
                   ${esc(STATUS_LABEL[inv.status] ?? inv.status)}</a>`
              : `<form method="post" action="/app/undangan" style="margin:0">
                   <input type="hidden" name="company_id" value="${esc(c.id)}">
                   <button class="btn btn-sm" type="submit">Terbitkan</button>
                 </form>`}</td>
          </tr>`
        }).join('')}</tbody>
  </table>
  ${paginasi('/app/perusahaan', query as Record<string, string>, halaman, tersaring.length)}
</div>

<div class="card">
  <h2>Tambah perusahaan klien</h2>
  <form method="post" action="/app/perusahaan">
    <label class="lbl" for="n">Nama perusahaan</label>
    <input class="field" name="name" id="n" required placeholder="PT Contoh Sejahtera"
           style="width:100%;margin-bottom:12px">
    <div class="grid grid-2">
      <div>
        <label class="lbl" for="i">Industri</label>
        <select class="field" name="industry" id="i" style="width:100%">
          ${Object.entries(INDUSTRI_LABEL)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="lbl" for="e">Jumlah karyawan</label>
        <select class="field" name="employee_band" id="e" style="width:100%">
          ${Object.entries(KARYAWAN_LABEL)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="btn btn-primary btn-sm btn-icon" type="submit" style="margin-top:14px">
      ${ICONS.tambah}Tambah perusahaan</button>
  </form>
</div>`,
      }), 200, cookiesBaru)
    }, { query: t.Object({ q: t.Optional(t.String()), page: t.Optional(t.String()) }) })

    // ── Tinjauan AI lintas perusahaan (FR-31, FR-32)
    .get('/app/tinjauan', async ({ sesi, query }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const { api, cookiesBaru } = s
      const [me, invitations] = await Promise.all([profil(api), daftarUndangan(api)])
      const selesai = invitations.filter((i) => i.status === 'SCORED')

      // Tinjauan yang sudah ada dibaca tanpa memanggil model.
      const tinjauan = await Promise.all(selesai.map(async (i) => {
        const res = await api(`/assessments/${i.assessment_id}/ai-review`)
        return { inv: i, review: res.ok ? await res.json() as Review : null }
      }))
      const sudah = tinjauan.filter((x) => x.review)
      const belum = tinjauan.length - sudah.length

      // Yang paling meragukan lebih dulu: itulah gunanya daftar ini.
      sudah.sort((a, b) => a.review!.data_quality - b.review!.data_quality)
      // Sama seperti daftar lain, tabel dipaginasi. Dengan ratusan perusahaan,
      // merender semuanya sekaligus membuat halaman membengkak tanpa guna.
      const urut = [...sudah, ...tinjauan.filter((x) => !x.review)]
      const halaman = Math.max(1, Number(query.page ?? '1') || 1)
      const potongan = urut.slice((halaman - 1) * PER_PAGE, halaman * PER_PAGE)

      return html(shell({
        title: 'Tinjauan AI — SiapAI', active: '/app/tinjauan', ...(me ? { email: me.email } : {}),
        body: `
<div class="page-head"><h1>Tinjauan AI</h1></div>
<p class="muted" style="margin-top:-8px">
  Skor kesiapan tetap dihitung dari rubrik. AI hanya menilai kualitas jawaban:
  kontradiksi, klaim tanpa bukti, dan hal yang perlu dikonfirmasi auditor.</p>

${query.gagal ? banner('error', esc(query.gagal)) : ''}
${query.selesai ? banner('ok', `${esc(query.selesai)} assessment selesai ditinjau.${
  query.sebagian ? ` ${esc(query.sebagian)} gagal dan dapat dicoba lagi.` : ''}`) : ''}

<div class="stats">
  ${stat(ICONS.ok, selesai.length, `Laporan selesai${invitations.length > selesai.length
    ? ` dari ${invitations.length} undangan` : ''}`)}
  ${stat(ICONS.tinjauan, sudah.length, 'Sudah ditinjau')}
  ${stat(ICONS.ulang, belum, 'Menunggu tinjauan', belum > 0 ? 'warn' : '')}
  ${(() => {
    const berat = sudah.filter((x) => x.review!.flags.some((f) => f.severity === 'high')).length
    return stat(ICONS.awas, berat, 'Ada temuan berat', berat > 0 ? 'warn' : '')
  })()}
</div>

${selesai.length === 0
  ? `<div class="card">
      <p class="muted">Belum ada laporan selesai untuk ditinjau.
         AI meninjau jawaban yang sudah dikirim responden, jadi undangan yang
         masih berstatus terkirim atau sedang diisi belum muncul di sini.</p>
      <p><a class="btn btn-sm" href="/app/undangan"
            style="display:inline-block;line-height:44px;text-decoration:none">
        Lihat status undangan</a></p>
     </div>`
  : `<div class="card">
      <h2>Tinjau massal</h2>
      <p class="muted">Meninjau assessment yang belum pernah ditinjau, maksimal
         ${PER_PAGE} sekaligus, agar biaya model tetap terkendali.</p>
      ${belum === 0
        ? `<p class="muted">Semua ${sudah.length} laporan yang selesai sudah ditinjau.
             Tinjauan baru muncul di sini setelah ada responden lain yang mengirim
             jawabannya. Untuk meninjau ulang yang sudah ada, buka perusahaannya
             lalu tekan tombol "Tinjau ulang".</p>`
        : ''}
      <form method="post" action="/app/tinjauan/jalankan" style="margin-top:12px">
        <button class="btn btn-primary btn-sm btn-icon" type="submit"
          ${belum === 0 ? 'disabled' : ''}>
          ${ICONS.tinjauan}${belum === 0
            ? 'Tidak ada yang perlu ditinjau' : `Tinjau ${belum} assessment`}</button>
      </form>
    </div>

    <div class="card">
      <h2>Hasil tinjauan</h2>
      <table class="tbl">
        <thead><tr><th>Perusahaan</th><th>Kualitas data</th><th>Temuan</th><th></th></tr></thead>
        <tbody>${potongan.length === 0
          ? `<tr><td colspan="4" class="muted">Belum ada.</td></tr>`
          : potongan.map(({ inv, review }) => `
            <tr>
              <td><strong>${esc(inv.company_name)}</strong></td>
              <td data-l="Kualitas data">${review
                ? `<strong>${review.data_quality}</strong><span class="muted">/100</span>`
                : '<span class="muted">Belum dinilai</span>'}</td>
              <td data-l="Temuan">${review
                ? (review.flags.length === 0
                    ? '<span class="muted">Tidak ada temuan</span>'
                    : review.flags.slice(0, 3).map((f) => sev(f.severity)).join(' '))
                : `<form method="post" action="/app/undangan/${esc(inv.id)}/tinjau"
                     style="margin:0">
                     <button class="btn btn-sm btn-icon" type="submit">
                       ${ICONS.tinjauan}Tinjau</button>
                   </form>`}</td>
              <td><a href="/app/undangan/${esc(inv.id)}">Buka</a></td>
            </tr>`).join('')}</tbody>
      </table>
      ${paginasi('/app/tinjauan', query as Record<string, string>, halaman, urut.length)}
    </div>`}`,
      }), 200, cookiesBaru)
    }, {
      query: t.Object({
        page: t.Optional(t.String()),
        gagal: t.Optional(t.String()),
        selesai: t.Optional(t.String()),
        sebagian: t.Optional(t.String()),
      }),
    })

    .post('/app/tinjauan/jalankan', async ({ sesi }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const res = await s.api('/ai-review/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: PER_PAGE }),
      })
      // Gagal diam-diam adalah yang terburuk: auditor menekan tombol, halaman
      // termuat ulang, dan tidak ada yang berubah tanpa penjelasan.
      if (!res.ok) return redirect(`/app/tinjauan?gagal=${encodeURIComponent(await pesan(res))}`)
      const d = await res.json() as { reviewed: number; items: { status: string }[] }
      const gagal = d.items.filter((x) => x.status !== 'reviewed').length
      return redirect(`/app/tinjauan?selesai=${d.reviewed}${gagal ? `&sebagian=${gagal}` : ''}`)
    })

    // ── Detail undangan dengan QR siap pindai (FR-23, FR-24)
    .get('/app/undangan/:id', async ({ sesi, params, query }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const { api, cookiesBaru } = s
      const me = await profil(api)
      const res = await api(`/invitations/${params.id}`)
      if (!res.ok) {
        return html(shell({
          title: 'Tidak ditemukan', active: '/app/undangan', ...(me ? { email: me.email } : {}),
          body: `<div class="card"><h1>Undangan tidak ditemukan</h1>
                 <p><a href="/app/undangan">Kembali ke daftar</a></p></div>`,
        }), 404, cookiesBaru)
      }
      const inv = await res.json() as Invitation
      const link = (inv as Invitation & { invitation_url?: string }).invitation_url
      // Tautan bagikan dan tinjauan hanya relevan setelah laporan ada.
      const bagikan = inv.status === 'SCORED'
        ? ((await (await api(`/assessments/${inv.assessment_id}/share-links`)).json())
            .items as ShareItem[])
        : []
      const reviewRes = inv.status === 'SCORED'
        ? await api(`/assessments/${inv.assessment_id}/ai-review`)
        : null
      const review = reviewRes?.ok ? await reviewRes.json() as Review : null

      return html(shell({
        title: `Undangan ${inv.company_name}`, active: '/app/undangan',
        ...(me ? { email: me.email } : {}),
        body: `
<p><a class="tautan-balik" href="/app/undangan">${ICONS.kembali}Kembali ke daftar</a></p>
<div class="page-head"><h1>${esc(inv.company_name)}</h1></div>
${query.gagal ? banner('error', esc(query.gagal)) : ''}
<p>${pill(inv.status)}
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
         <p><a class="btn btn-primary btn-sm" href="${esc(link)}" target="_blank"
               style="display:inline-block;line-height:44px;text-decoration:none;
                      text-align:center">Buka form di tab baru</a></p>`
      : `<p class="muted">Tautan tidak tersedia untuk undangan ini.
           Terbitkan ulang untuk memperoleh tautan baru.</p>`}
    <form method="post" action="/app/undangan/${esc(inv.id)}/reissue" style="margin-top:16px">
      <button class="btn btn-sm btn-icon" type="submit">
        ${ICONS.ulang}Terbitkan ulang token</button>
    </form>
    <p class="muted" style="margin-top:12px">
      Berlaku sampai ${esc(tanggal(inv.expires_at))}</p>
  </div>
</div>

${inv.status === 'SCORED'
  ? `<div class="card">
      <h2>Hasil sudah tersedia</h2>
      <p class="muted">Responden telah mengirim jawaban dan laporan sudah dihitung.</p>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px">
        ${link
          ? `<a class="btn btn-primary btn-sm" href="${esc(link)}/hasil"
                style="line-height:44px;text-decoration:none;text-align:center">
               Lihat laporan</a>`
          : ''}
        <a class="btn btn-sm btn-icon" href="/app/undangan/${esc(inv.id)}/pdf"
           style="text-decoration:none">${ICONS.unduh}Unduh PDF</a>
        <form method="post" action="/app/undangan/${esc(inv.id)}/bagikan" style="margin:0">
          <button class="btn btn-sm btn-icon" type="submit">
            ${ICONS.bagikan}Buat tautan bagikan</button>
        </form>
      </div>
      ${bagikan.length
        ? `<h3 style="font-size:16px;margin:20px 0 8px">Tautan bagikan</h3>
           ${bagikan.map((b) => `
             <div style="border-top:1px solid var(--border);padding:12px 0">
               ${b.url ? `<div class="copybox">${esc(b.url)}</div>` : ''}
               <p class="muted" style="margin:4px 0">
                 ${b.revoked ? 'Dicabut' : `Berlaku sampai ${esc(tanggal(b.expires_at))}`}
                 · dilihat ${b.view_count}x
                 ${b.anonymize ? ' · nama disembunyikan' : ''}
               </p>
               ${b.revoked ? '' : `<form method="post"
                  action="/app/bagikan/${esc(b.id)}/cabut" style="margin:0">
                 <button class="btn btn-sm" type="submit">Cabut</button>
               </form>`}
             </div>`).join('')}`
        : ''}
     </div>

     <div class="card">
       <h2>Tinjauan AI</h2>
       ${review
         ? `<p><strong style="font-size:22px">${review.data_quality}/100</strong>
              <span class="muted"> kualitas data · ${esc(review.model)}</span></p>
            <p>${esc(review.summary)}</p>
            ${review.flags.length === 0
              ? '<p class="muted">Tidak ada temuan yang perlu dikonfirmasi.</p>'
              : review.flags.map((f) => `
                <div class="flag">
                  ${sev(f.severity)}
                  ${f.question_codes.length
                    ? `<span class="q"> ${esc(f.question_codes.join(', '))}</span>` : ''}
                  <p style="margin:6px 0 4px">${esc(f.issue)}</p>
                  ${f.follow_up ? `<p class="muted">Tanyakan: ${esc(f.follow_up)}</p>` : ''}
                </div>`).join('')}
            ${review.next_checks.length
              ? `<h3 style="font-size:15px;margin:16px 0 6px">Langkah verifikasi</h3>
                 <ul class="muted">${review.next_checks
                   .map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
              : ''}`
         : `<p class="muted">Belum ditinjau. AI akan memeriksa konsistensi jawaban dan
              menyiapkan pertanyaan konfirmasi untuk Anda.</p>`}
       <form method="post" action="/app/undangan/${esc(inv.id)}/tinjau" style="margin-top:12px">
         <button class="btn btn-sm btn-icon" type="submit">
           ${review ? ICONS.ulang : ICONS.tinjauan}${review ? 'Tinjau ulang' : 'Tinjau dengan AI'}</button>
       </form>
     </div>`
  : ''}`,
      }), 200, cookiesBaru)
    }, {
      params: t.Object({ id: t.String() }),
      query: t.Object({ gagal: t.Optional(t.String()) }),
    })

    // Proksi gambar QR agar dashboard tidak perlu menyematkan kredensial di HTML.
    .get('/app/undangan/:id/qr.png', async ({ sesi, params, set }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const res = await s.api(`/invitations/${params.id}/qr.png`)
      if (!res.ok) { set.status = 404; return 'not found' }
      set.headers['content-type'] = 'image/png'
      set.headers['cache-control'] = 'private, no-store'
      return new Response(await res.arrayBuffer())
    }, { params: t.Object({ id: t.String() }) })

    .post('/app/undangan', async ({ sesi, body }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const f = body as Record<string, string>
      const res = await s.api('/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company_id: f.company_id,
          ...(f.recipient_name ? { recipient_name: f.recipient_name } : {}),
        }),
      })
      if (!res.ok) {
        const e = await res.json() as {
          error: { message: string; details?: { invitation_id?: string } }
        }
        const id = e.error.details?.invitation_id
        // Sudah ada undangan aktif: arahkan ke sana, jangan buntu.
        return id ? redirect(`/app/undangan/${id}`) : html(shell({
          title: 'Gagal', active: '/app/undangan',
          body: `<div class="card"><h1>Tidak dapat menerbitkan</h1>
                 <p>${esc(e.error.message)}</p>
                 <p><a href="/app/undangan">Kembali</a></p></div>`,
        }), 409)
      }
      const inv = await res.json() as { id: string }
      return redirect(`/app/undangan/${inv.id}`)
    })

    .post('/app/undangan/:id/reissue', async ({ sesi, params }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const res = await s.api(`/invitations/${params.id}/reissue`, { method: 'POST' })
      if (!res.ok) return redirect('/app/undangan')
      const inv = await res.json() as { id: string }
      return redirect(`/app/undangan/${inv.id}`)
    }, { params: t.Object({ id: t.String() }) })

    // ── FR-31 tinjauan AI untuk satu undangan
    .post('/app/undangan/:id/tinjau', async ({ sesi, params }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const inv = await (await s.api(`/invitations/${params.id}`)).json() as Invitation
      // refresh=1: tombol ini selalu berarti "tinjau sekarang", bukan baca cache.
      const res = await s.api(`/assessments/${inv.assessment_id}/ai-review?refresh=1`,
        { method: 'POST' })
      if (!res.ok) {
        return redirect(`/app/undangan/${params.id}?gagal=${
          encodeURIComponent(await pesan(res))}`)
      }
      return redirect(`/app/undangan/${params.id}`)
    }, { params: t.Object({ id: t.String() }) })

    // ── FR-18 buat tautan bagikan dari dashboard
    .post('/app/undangan/:id/bagikan', async ({ sesi, params }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const inv = await (await s.api(`/invitations/${params.id}`)).json() as Invitation
      await s.api(`/assessments/${inv.assessment_id}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      return redirect(`/app/undangan/${params.id}`)
    }, { params: t.Object({ id: t.String() }) })

    .post('/app/bagikan/:id/cabut', async ({ sesi, params, headers }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      await s.api(`/share-links/${params.id}`, { method: 'DELETE' })
      // Kembali ke halaman asal agar konteks auditor tidak hilang.
      return redirect(headers.referer ?? '/app/undangan')
    }, { params: t.Object({ id: t.String() }) })

    // ── FR-17 unduh PDF lewat dashboard
    .get('/app/undangan/:id/pdf', async ({ sesi, params, set }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const inv = await (await s.api(`/invitations/${params.id}`)).json() as Invitation
      const res = await s.api(`/assessments/${inv.assessment_id}/report/pdf`, { method: 'POST' })
      if (!res.ok) {
        return html(shell({
          title: 'Gagal membuat PDF', active: '/app/undangan',
          body: `<div class="card"><h1>PDF belum dapat dibuat</h1>
            <p class="muted">Perender PDF tidak tersedia di lingkungan ini.</p>
            <p><a href="/app/undangan/${esc(params.id)}">Kembali</a></p></div>`,
        }), res.status)
      }
      set.headers['content-type'] = 'application/pdf'
      set.headers['content-disposition'] =
        res.headers.get('content-disposition') ?? 'attachment; filename="laporan.pdf"'
      return new Response(await res.arrayBuffer())
    }, { params: t.Object({ id: t.String() }) })

    .post('/app/perusahaan', async ({ sesi, body }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const f = body as Record<string, string>
      await s.api('/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: f.name, industry: f.industry, employee_band: f.employee_band,
        }),
      })
      return redirect('/app/perusahaan')
    })
}

/**
 * Pesan yang layak dibaca manusia dari respons API yang gagal.
 * Amplop error punya bentuk seragam, tetapi 503 dari perender atau model bisa
 * datang tanpa badan JSON sama sekali.
 */
async function pesan(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
  return body?.error?.message ?? `Permintaan gagal (${res.status})`
}

// ── Pengambilan data

const profil = async (api: AuthedApi): Promise<Me | null> => {
  const res = await api('/auth/me')
  return res.ok ? await res.json() as Me : null
}

const daftarUndangan = async (api: AuthedApi): Promise<Invitation[]> => {
  const res = await api('/invitations')
  return res.ok ? (await res.json() as { items: Invitation[] }).items : []
}

const daftarPerusahaan = async (api: AuthedApi): Promise<Company[]> => {
  const res = await api('/companies')
  return res.ok ? (await res.json() as { items: Company[] }).items : []
}

// ── Potongan tampilan

/**
 * Lencana status undangan.
 * Disertai titik berwarna agar status tetap dapat dibedakan bentuknya, tidak
 * semata-mata bergantung pada warna teks.
 */
function pill(status: string): string {
  return `<span class="pill" style="color:${STATUS_COLOR[status] ?? 'var(--muted)'}">
    <span class="dot"></span>${esc(STATUS_LABEL[status] ?? status)}</span>`
}

/** Lencana tingkat temuan AI, dengan ikon pembeda selain warna. */
function sev(tingkat: string): string {
  const icon = tingkat === 'high' ? ICONS.awas : tingkat === 'medium' ? ICONS.cari : ICONS.ok
  return `<span class="sev sev-${esc(tingkat)}">${icon}${
    esc(SEV_LABEL[tingkat] ?? tingkat)}</span>`
}

/** Kartu statistik: angka besar, ikon, dan label yang menerangkan artinya. */
function stat(icon: string, angka: number, label: string, nada = ''): string {
  return `<div class="stat${nada ? ` stat-${nada}` : ''}">
    <span class="ic">${icon}</span>
    <span><b>${angka}</b><span>${label}</span></span>
  </div>`
}

/** Banner berikon; pesan penting tidak boleh hanya dibedakan oleh warna. */
function banner(jenis: 'ok' | 'warn' | 'error', isi: string): string {
  const icon = jenis === 'ok' ? ICONS.ok : ICONS.awas
  return `<div class="banner banner-${jenis}" role="${
    jenis === 'error' ? 'alert' : 'status'}">${icon}<span>${isi}</span></div>`
}

function barisUndangan(i: Invitation): string {
  return `<tr>
    <td>
      <strong>${esc(i.company_name)}</strong><br>
      <span class="muted">${esc(i.recipient_name ?? 'Tanpa nama penerima')}</span>
    </td>
    <td data-l="Status">${pill(i.status)}</td>
    <td data-l="Progres">
      <span style="display:block">
        ${i.progress.answered}/${i.progress.total_visible}
        <div class="progress" style="margin-top:6px;width:110px">
          <i style="width:${i.progress.percent}%"></i>
        </div>
      </span>
    </td>
    <td><a href="/app/undangan/${esc(i.id)}">Lihat QR</a></td>
  </tr>`
}

/** Navigasi halaman; hanya muncul bila memang ada lebih dari satu halaman. */
function paginasi(
  base: string, query: Record<string, string>, halaman: number, total: number,
): string {
  const jumlah = Math.ceil(total / PER_PAGE)
  if (jumlah <= 1) return ''
  const tautan = (n: number, label: string) => {
    const p = new URLSearchParams({ ...query, page: String(n) })
    return `<a class="btn btn-sm" href="${base}?${p}"
      style="display:inline-block;line-height:44px;text-decoration:none">${label}</a>`
  }
  return `<div class="toolbar" style="margin:16px 0 0">
    ${halaman > 1 ? tautan(halaman - 1, '← Sebelumnya') : ''}
    <span class="muted">Halaman ${halaman} dari ${jumlah} · ${total} entri</span>
    ${halaman < jumlah ? tautan(halaman + 1, 'Berikutnya →') : ''}
  </div>`
}

interface Me { id: string; email: string; name: string; role: string }

interface Invitation {
  id: string
  company_id: string
  assessment_id: string
  company_name: string
  status: string
  recipient_name?: string
  expires_at: string
  progress: { answered: number; total_visible: number; percent: number }
}
interface Company {
  id: string
  name: string
  industry: string
  employee_band: string
}

interface ShareItem {
  id: string
  url: string | null
  expires_at: string
  anonymize: boolean
  revoked: boolean
  view_count: number
}

interface Review {
  data_quality: number
  summary: string
  flags: { question_codes: string[]; severity: string; issue: string; follow_up: string }[]
  next_checks: string[]
  model: string
  reviewed_at: string
}

const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
