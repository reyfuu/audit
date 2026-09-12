/**
 * View HTML untuk responden.
 *
 * Keputusan: server-rendered dengan form HTML biasa, JavaScript hanya sebagai
 * peningkatan (autosave). Alasannya jalur masuk utama adalah pindai QR di HP,
 * sering pada koneksi seluler yang buruk; SPA berat berisiko gagal dimuat dan
 * langsung mematikan satu-satunya kesempatan owner mengisi. Dengan progressive
 * enhancement, tombol "Lanjut" tetap bekerja walau JS gagal dimuat.
 */
import type { Question } from '@siapai/scoring'
import { STYLES } from './styles'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export interface Progress {
  answered: number
  total_visible: number
  percent: number
  estimated_minutes_left: number
}

function layout(title: string, body: string, opts: { script?: string } = {}): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0B2E4F">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
${opts.script ? `<script>${opts.script}</script>` : ''}
</body>
</html>`
}

function bar(saveState = ''): string {
  return `<header class="bar">
  <span class="brand">SiapAI</span>
  <span class="save" id="save" data-state="${esc(saveState)}" aria-live="polite"></span>
</header>`
}

function progressBar(p: Progress): string {
  return `<div class="progress-meta">
  <span>${p.answered} dari ${p.total_visible} pertanyaan</span>
  <span>~${p.estimated_minutes_left} menit lagi</span>
</div>
<div class="progress" role="progressbar" aria-valuenow="${p.percent}" aria-valuemin="0" aria-valuemax="100"
     aria-label="Kemajuan pengisian ${p.percent} persen">
  <i style="width:${p.percent}%"></i>
</div>`
}

// ── Halaman sambutan (FR-25 AC1)
export function welcomePage(d: {
  token: string
  company_name: string
  invited_by: string
  total_questions: number
  estimated_minutes: number
  resume: boolean
  progress: Progress
  expires_at: string
}): string {
  const tanggal = new Date(d.expires_at).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  return layout(`Audit Kesiapan AI — ${d.company_name}`, `
${bar()}
<main class="wrap">
  <div class="card">
    <p class="eyebrow">Audit Kesiapan AI</p>
    <h1>${esc(d.company_name)}</h1>
    <p class="muted">Diundang oleh ${esc(d.invited_by)}</p>
    <p>Formulir ini menilai sejauh mana perusahaan Anda siap mengadopsi AI,
       mencakup strategi, data, teknologi, SDM, proses, tata kelola, dan finansial.</p>
    <ul class="muted">
      <li>${d.total_questions} pertanyaan, sekitar ${d.estimated_minutes} menit</li>
      <li>Jawaban tersimpan otomatis, boleh ditinggal dan dilanjutkan kapan saja</li>
      <li>Bisa dilanjutkan di perangkat lain lewat tautan atau QR yang sama</li>
      <li>Tautan berlaku sampai ${esc(tanggal)}</li>
    </ul>
    ${d.resume ? `<div class="banner banner-ok">
      Anda sudah mengisi ${d.progress.answered} pertanyaan. Lanjutkan dari tempat terakhir.
    </div>${progressBar(d.progress)}` : ''}
  </div>
</main>
<div class="actions"><div class="inner">
  <a class="btn btn-primary" style="text-align:center;line-height:48px;text-decoration:none"
     href="/f/${esc(d.token)}/isi">${d.resume ? 'Lanjutkan' : 'Mulai isi'}</a>
</div></div>`)
}

// ── Satu pertanyaan per layar (PRD §9)
export function questionPage(d: {
  token: string
  question: Question
  index: number
  total: number
  dimensionName: string
  sectionIndex: number
  sectionTotal: number
  value?: unknown
  progress: Progress
  prevHref?: string
}): string {
  const q = d.question
  const selected = pickSelected(d.value)
  const options = (q.options ?? []).map((o, i) => {
    const type = q.type === 'multi_choice' ? 'checkbox' : 'radio'
    const checked = q.type === 'multi_choice'
      ? Array.isArray(selected) && selected.includes(o.code)
      : selected === o.code
    return `<label class="opt" for="o${i}">
      <input type="${type}" id="o${i}" name="value" value="${esc(o.code)}" ${checked ? 'checked' : ''}
             ${q.type === 'multi_choice' ? '' : 'required'}>
      <span>${esc(o.label)}</span>
    </label>`
  }).join('')

  const scaleInputs = q.type === 'scale_1_5'
    ? [1, 2, 3, 4, 5].map((n) => `<label class="opt" for="s${n}">
        <input type="radio" id="s${n}" name="value" value="${n}" ${selected === n ? 'checked' : ''} required>
        <span>${n} ${n === 1 ? '— sangat rendah' : n === 5 ? '— sangat tinggi' : ''}</span>
      </label>`).join('')
    : ''

  const boolInputs = q.type === 'boolean'
    ? `<label class="opt" for="by"><input type="radio" id="by" name="value" value="true"
         ${selected === true ? 'checked' : ''} required><span>Ya</span></label>
       <label class="opt" for="bn"><input type="radio" id="bn" name="value" value="false"
         ${selected === false ? 'checked' : ''} required><span>Belum</span></label>`
    : ''

  return layout(`${q.prompt} — SiapAI`, `
${bar('')}
<main class="wrap">
  ${progressBar(d.progress)}
  <div class="card">
    <p class="eyebrow">${esc(d.dimensionName)} · bagian ${d.sectionIndex} dari ${d.sectionTotal}</p>
    <form method="post" action="/f/${esc(d.token)}/isi" id="qform">
      <input type="hidden" name="question_code" value="${esc(q.code)}">
      <input type="hidden" name="type" value="${esc(q.type)}">
      <fieldset>
        <legend>${esc(q.prompt)}</legend>
        ${q.help_text ? `<p class="help">${esc(q.help_text)}</p>` : ''}
        ${options}${scaleInputs}${boolInputs}
      </fieldset>
    </form>
  </div>
</main>
<div class="actions"><div class="inner">
  ${d.prevHref ? `<a class="btn" style="text-align:center;line-height:48px;text-decoration:none"
      href="${esc(d.prevHref)}">Kembali</a>` : ''}
  <button class="btn btn-primary" type="submit" form="qform">Lanjut</button>
</div></div>`, {
    script: `
// Peningkatan progresif: simpan segera setelah opsi dipilih, lalu lanjut.
// Bila skrip ini gagal dimuat, tombol Lanjut tetap mengirim form seperti biasa.
(function () {
  var form = document.getElementById('qform');
  var save = document.getElementById('save');
  if (!form) return;
  function mark(state, text) { save.dataset.state = state; save.textContent = text; }
  form.addEventListener('change', function () {
    mark('saving', 'Menyimpan...');
    var data = new FormData(form);
    fetch(form.action, { method: 'POST', body: data, headers: { 'x-async': '1' } })
      .then(function (r) { mark(r.ok ? 'saved' : 'error', r.ok ? 'Tersimpan' : 'Gagal simpan'); })
      .catch(function () { mark('error', 'Tersimpan di perangkat ini'); });
  });
})();`,
  })
}

function pickSelected(v: unknown): unknown {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if ('choice' in o) return o.choice
  if ('choices' in o) return o.choices
  if ('scale' in o) return o.scale
  if ('bool' in o) return o.bool
  if ('number' in o) return o.number
  return undefined
}

// ── Review sebelum kirim (FR-11)
export function reviewPage(d: {
  token: string
  progress: Progress
  missing: { code: string; prompt: string }[]
}): string {
  const siap = d.missing.length === 0
  return layout('Periksa jawaban — SiapAI', `
${bar()}
<main class="wrap">
  ${progressBar(d.progress)}
  <div class="card">
    <h1>Periksa sebelum kirim</h1>
    ${siap
      ? `<div class="banner banner-ok">Semua pertanyaan sudah terjawab. Anda siap mengirim.</div>`
      : `<div class="banner banner-warn">
           Masih ada ${d.missing.length} pertanyaan yang belum dijawab. Ketuk untuk melengkapi.
         </div>
         <nav class="missing-list">
           ${d.missing.map((m) => `<a href="/f/${esc(d.token)}/isi?q=${esc(m.code)}">${esc(m.prompt)}</a>`).join('')}
         </nav>`}
  </div>
</main>
<div class="actions"><div class="inner">
  <a class="btn" style="text-align:center;line-height:48px;text-decoration:none"
     href="/f/${esc(d.token)}/isi">Kembali mengisi</a>
  <form method="post" action="/f/${esc(d.token)}/kirim" style="flex:1;margin:0">
    <button class="btn btn-primary" type="submit" ${siap ? '' : 'disabled'} style="width:100%">
      Kirim jawaban
    </button>
  </form>
</div></div>`)
}

// ── Halaman hasil (DESIGN B5, terbuka penuh sesuai FR-30)
export function resultPage(d: {
  company_name: string
  result: {
    total_score: number
    level: number
    verdict: string
    confidence: string
    summary: string
    gates: { code: string; triggered: boolean; message: string }[]
    dimensions: { dimension_code: string; name: string; score: number; level: number }[]
  }
  recommendations: {
    items: {
      code: string; title: string; body: string; impact: number; effort: number
      horizon: string; owner_role: string; cost_band: string; rank: number
    }[]
    roadmap: Record<string, string[]>
  }
}): string {
  const verdictLabel: Record<string, string> = {
    READY: 'Siap',
    CONDITIONALLY_READY: 'Siap bersyarat',
    NOT_READY: 'Belum siap',
  }
  const horizonLabel: Record<string, string> = {
    '0_3M': '0–3 bulan', '3_6M': '3–6 bulan', '6_12M': '6–12 bulan',
  }
  const costLabel: Record<string, string> = {
    under_10jt: '< Rp 10 jt', '10_30jt': 'Rp 10–30 jt', '30_100jt': 'Rp 30–100 jt',
    '100_500jt': 'Rp 100–500 jt', above_500jt: '> Rp 500 jt',
  }

  const gates = d.result.gates.filter((g) => g.triggered)
    .map((g) => `<div class="banner banner-warn">${esc(g.message)}</div>`).join('')

  const dims = d.result.dimensions.map((x) => `
    <div class="dim">
      <div class="dim-head"><span>${esc(x.name)}</span><b>${x.score} · L${x.level}</b></div>
      <div class="meter"><i style="width:${x.score}%;background:var(--l${x.level})"></i></div>
    </div>`).join('')

  const recs = d.recommendations.items.map((r) => `
    <article class="rec">
      <h3>${r.rank}. ${esc(r.title)}</h3>
      <p class="muted">${esc(r.body)}</p>
      <div class="tags">
        <span class="tag">Dampak ${r.impact}/5</span>
        <span class="tag">Usaha ${r.effort}/5</span>
        <span class="tag">${esc(horizonLabel[r.horizon] ?? r.horizon)}</span>
        <span class="tag">${esc(r.owner_role)}</span>
        <span class="tag">${esc(costLabel[r.cost_band] ?? r.cost_band)}</span>
      </div>
    </article>`).join('')

  return layout(`Hasil audit — ${d.company_name}`, `
${bar()}
<main class="wrap">
  <div class="card verdict">
    <p class="eyebrow">Hasil audit kesiapan AI</p>
    <h1 style="font-size:20px">${esc(d.company_name)}</h1>
    <div class="score v-${esc(d.result.verdict)}">${d.result.total_score}</div>
    <div class="label v-${esc(d.result.verdict)}">
      ${esc(verdictLabel[d.result.verdict] ?? d.result.verdict)}
    </div>
    <p class="muted">Level ${d.result.level} dari 5 · Keyakinan data ${esc(d.result.confidence)}</p>
  </div>
  ${gates}
  <div class="card">
    <h2>Ringkasan</h2>
    <p>${esc(d.result.summary)}</p>
  </div>
  <div class="card">
    <h2>Skor per dimensi</h2>
    <p class="muted">Angka menyertai warna, sehingga tetap terbaca tanpa membedakan warna.</p>
    ${dims}
  </div>
  <div class="card">
    <h2>Langkah prioritas</h2>
    <p class="muted">Diurutkan berdasar dampak dibanding usaha.</p>
    ${recs}
  </div>
</main>`)
}

// ── Halaman tautan tidak berlaku (FR-25 AC3, DESIGN B7)
export function invalidPage(): string {
  return layout('Tautan tidak berlaku — SiapAI', `
${bar()}
<main class="wrap">
  <div class="card">
    <h1>Tautan ini sudah tidak berlaku</h1>
    <p class="muted">Tautan undangan mungkin sudah kedaluwarsa atau dicabut.
       Silakan hubungi auditor Anda untuk memperoleh tautan atau QR baru.</p>
  </div>
</main>`)
}

export function submittedPage(token: string): string {
  return layout('Terima kasih — SiapAI', `
${bar()}
<main class="wrap">
  <div class="card">
    <h1>Terima kasih</h1>
    <p>Jawaban Anda sudah terkirim dan hasilnya sudah dihitung.</p>
  </div>
</main>
<div class="actions"><div class="inner">
  <a class="btn btn-primary" style="text-align:center;line-height:48px;text-decoration:none"
     href="/f/${esc(token)}/hasil">Lihat hasil</a>
</div></div>`)
}
