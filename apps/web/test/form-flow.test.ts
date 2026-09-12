import '../../api/test/setup-dev-tokens'
/**
 * Uji form responden dengan menelusuri HTML seperti browser tanpa JavaScript.
 *
 * Ini menguji jalur penerimaan sesungguhnya: owner memindai QR, membuka
 * halaman, menekan tombol, dan mengirim form. Bila alur ini lulus tanpa JS,
 * ia pasti lulus juga dengan JS.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../../api/src/app'
import { createWeb, toAnswerValue } from '../src/web'

const BASE = 'http://localhost:3000'

async function setup() {
  const { app: apiApp, repo } = createApp({ baseUrl: 'http://localhost:3001' })
  const api = (path: string, init?: RequestInit) =>
    apiApp.handle(new Request(`http://localhost:3001${path}`, init))
  const web = createWeb({ api })
  const auditor = await repo.createAuditor({ email: 'a@x.id', name: 'Dimas', role: 'auditor' })
  const company = await repo.createCompany({
    owner_auditor_id: auditor.id, name: 'PT Maju Jaya',
    industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
  })
  const get = (path: string) => web.handle(new Request(`${BASE}${path}`))
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
    web.handle(new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
    }))
  return { apiApp, api, web, repo, auditor, company, get, post }
}

async function issue(t: Awaited<ReturnType<typeof setup>>) {
  const r = await t.api('/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer user:${t.auditor.id}` },
    body: JSON.stringify({ company_id: t.company.id }),
  })
  return (await r.json()) as { token: string; id: string }
}

/** Parser minimal untuk memeriksa HTML seperti yang dilihat browser. */
function parseForm(htmlStr: string) {
  const action = /<form[^>]*action="([^"]+)"[^>]*>/.exec(htmlStr)?.[1] ?? ''
  const hidden = [...htmlStr.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)]
  const options = [...htmlStr.matchAll(/<input type="(radio|checkbox)"[^>]*name="value" value="([^"]+)"/g)]
    .map((m) => m[2]!)
  const legend = /<legend>([\s\S]*?)<\/legend>/.exec(htmlStr)?.[1]?.trim() ?? ''
  return {
    action,
    fields: Object.fromEntries(hidden.map((m) => [m[1]!, m[2]!])),
    options,
    legend,
  }
}

/** Mengikuti redirect 303 seperti browser. */
async function follow(t: Awaited<ReturnType<typeof setup>>, res: Response, max = 5): Promise<Response> {
  let r = res
  for (let i = 0; i < max && r.status === 303; i++) {
    r = await t.get(r.headers.get('location')!)
  }
  return r
}

/** Mengisi seluruh form hanya dengan menekan tombol, tanpa JavaScript. */
async function fillWithoutJs(t: Awaited<ReturnType<typeof setup>>, token: string) {
  let page = await (await t.get(`/f/${token}/isi`)).text()
  for (let i = 0; i < 80; i++) {
    const f = parseForm(page)
    if (!f.fields.question_code) break
    const pilih = f.options[f.options.length - 1]! // opsi terbaik
    const res = await t.post(f.action.replace(BASE, ''), {
      question_code: f.fields.question_code,
      type: f.fields.type!,
      value: pilih,
    })
    const next = await follow(t, res)
    if (next.url.includes('/periksa') || (await next.clone().text()).includes('Periksa sebelum kirim')) {
      return await next.text()
    }
    page = await next.text()
  }
  return await (await t.get(`/f/${token}/periksa`)).text()
}

// ────────────────────────────────────────────────────────────────
describe('halaman sambutan', () => {
  it('menampilkan nama perusahaan, pengundang, dan estimasi waktu', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}`)).text()
    expect(page).toContain('PT Maju Jaya')
    expect(page).toContain('Dimas')
    expect(page).toContain('Mulai isi')
    expect(page).toMatch(/\d+ pertanyaan/)
  })

  it('token tidak berlaku menampilkan halaman netral, bukan error mentah', async () => {
    const t = await setup()
    const res = await t.get('/f/token-palsu')
    expect(res.status).toBe(404)
    const page = await res.text()
    expect(page).toContain('sudah tidak berlaku')
    expect(page).not.toContain('INVITATION_INVALID')
  })

  it('setelah ada jawaban, tombol berubah menjadi Lanjutkan (FR-26)', async () => {
    const t = await setup()
    const inv = await issue(t)
    const first = parseForm(await (await t.get(`/f/${inv.token}/isi`)).text())
    await t.post(`/f/${inv.token}/isi`, {
      question_code: first.fields.question_code!,
      type: first.fields.type!,
      value: first.options[0]!,
    })
    const page = await (await t.get(`/f/${inv.token}`)).text()
    expect(page).toContain('Lanjutkan')
    expect(page).toContain('sudah mengisi')
  })
})

describe('label seksi jujur', () => {
  it('pertanyaan profil tidak dilabeli sebagai dimensi berskor', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    // Pertanyaan pertama adalah profil "jumlah karyawan". Melabelinya sebagai
    // "Strategi & Kepemimpinan" menyesatkan responden.
    expect(page).toContain('Berapa jumlah karyawan')
    expect(page).toContain('Profil Perusahaan')
    expect(page).not.toContain('STRATEGI &amp; KEPEMIMPINAN')
  })

  it('pertanyaan strategi memang dilabeli Strategi & Kepemimpinan', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi?q=STR-01`)).text()
    expect(parseForm(page).fields.question_code).toBe('STR-01')
    expect(page).toContain('Strategi &amp; Kepemimpinan')
  })

  it('jumlah seksi mencakup profil ditambah tujuh dimensi', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toContain('bagian 1 dari 8')
  })
})

describe('PRD §9 mobile-first & aksesibilitas', () => {
  it('punya viewport meta agar tidak ditampilkan sebagai halaman desktop', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}`)).text()
    expect(page).toContain('width=device-width')
    expect(page).toContain('viewport-fit=cover')
  })

  it('ukuran teks dasar 16px agar iOS tidak zoom saat fokus input', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toContain('font-size:16px')
  })

  it('target sentuh opsi minimal 44px', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toMatch(/\.opt\s*\{[^}]*min-height:44px/)
  })

  it('satu pertanyaan per layar (PRD §9)', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect((page.match(/<legend>/g) ?? []).length).toBe(1)
    expect((page.match(/<fieldset>/g) ?? []).length).toBe(1)
  })

  it('grup pilihan memakai fieldset/legend dan label yang tertaut', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toContain('<fieldset>')
    expect(page).toContain('<legend>')
    const labels = [...page.matchAll(/<label class="opt" for="([^"]+)"/g)].map((m) => m[1]!)
    for (const id of labels) expect(page).toContain(`id="${id}"`)
    expect(labels.length).toBeGreaterThan(1)
  })

  it('progress bar punya atribut ARIA yang benar', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toContain('role="progressbar"')
    expect(page).toMatch(/aria-valuenow="[\d.]+"/)
    expect(page).toContain('aria-valuemin="0"')
    expect(page).toContain('aria-valuemax="100"')
  })

  it('halaman form tidak diindeks mesin pencari (FR-25 AC5)', async () => {
    const t = await setup()
    const inv = await issue(t)
    const res = await t.get(`/f/${inv.token}/isi`)
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await res.text()).toContain('name="robots"')
  })

  it('menghormati preferensi kurangi animasi', async () => {
    const t = await setup()
    const inv = await issue(t)
    expect(await (await t.get(`/f/${inv.token}`)).text()).toContain('prefers-reduced-motion')
  })
})

describe('pengisian tanpa JavaScript (progressive enhancement)', () => {
  it('form memakai POST biasa sehingga berfungsi tanpa JS', async () => {
    const t = await setup()
    const inv = await issue(t)
    const f = parseForm(await (await t.get(`/f/${inv.token}/isi`)).text())
    expect(f.action).toContain(`/f/${inv.token}/isi`)
    expect(f.fields.question_code).toBeTruthy()
    expect(f.options.length).toBeGreaterThan(1)
  })

  it('menjawab satu pertanyaan mengarahkan ke pertanyaan berikutnya', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page1 = await (await t.get(`/f/${inv.token}/isi`)).text()
    const f1 = parseForm(page1)
    const res = await t.post(`/f/${inv.token}/isi`, {
      question_code: f1.fields.question_code!, type: f1.fields.type!, value: f1.options[0]!,
    })
    expect(res.status).toBe(303)
    const page2 = await (await follow(t, res)).text()
    const f2 = parseForm(page2)
    expect(f2.fields.question_code).not.toBe(f1.fields.question_code)
  })

  it('progres bertambah setelah menjawab', async () => {
    const t = await setup()
    const inv = await issue(t)
    const f = parseForm(await (await t.get(`/f/${inv.token}/isi`)).text())
    await t.post(`/f/${inv.token}/isi`, {
      question_code: f.fields.question_code!, type: f.fields.type!, value: f.options[0]!,
    })
    const page = await (await t.get(`/f/${inv.token}/isi`)).text()
    expect(page).toMatch(/1 dari \d+ pertanyaan/)
  })

  it('jawaban tersimpan muncul kembali sebagai pilihan tercentang (FR-26)', async () => {
    const t = await setup()
    const inv = await issue(t)
    const f = parseForm(await (await t.get(`/f/${inv.token}/isi`)).text())
    const code = f.fields.question_code!
    await t.post(`/f/${inv.token}/isi`, {
      question_code: code, type: f.fields.type!, value: f.options[1]!,
    })
    const page = await (await t.get(`/f/${inv.token}/isi?q=${code}`)).text()
    expect(page).toMatch(new RegExp(`value="${f.options[1]}"[^>]*checked`))
  })

  it('alur penuh tanpa JS: isi semua, periksa, kirim, lihat hasil', async () => {
    const t = await setup()
    const inv = await issue(t)

    const review = await fillWithoutJs(t, inv.token)
    expect(review).toContain('Periksa sebelum kirim')
    expect(review).toContain('Semua pertanyaan sudah terjawab')

    const kirim = await t.post(`/f/${inv.token}/kirim`, {})
    const terkirim = await kirim.text()
    expect(terkirim).toContain('Terima kasih')

    const hasil = await (await t.get(`/f/${inv.token}/hasil`)).text()
    expect(hasil).toContain('PT Maju Jaya')
    expect(hasil).toMatch(/Siap|Belum siap|Siap bersyarat/)
    expect(hasil).toContain('Langkah prioritas')
    expect(hasil).toContain('Skor per dimensi')
  })
})

describe('halaman periksa (FR-11)', () => {
  it('menampilkan pertanyaan yang kurang dengan teksnya, bukan hanya kode', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/periksa`)).text()
    expect(page).toContain('belum dijawab')
    // Bukan sekadar "DAT-01", melainkan kalimat pertanyaannya.
    expect(page).toMatch(/<a href="[^"]*q=DAT-01">[^<]{20,}/)
  })

  it('tombol kirim nonaktif selama masih ada yang kosong', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/periksa`)).text()
    expect(page).toMatch(/<button[^>]*disabled/)
  })

  it('tautan lompat membuka pertanyaan yang dimaksud', async () => {
    const t = await setup()
    const inv = await issue(t)
    const page = await (await t.get(`/f/${inv.token}/isi?q=GOV-01`)).text()
    expect(parseForm(page).fields.question_code).toBe('GOV-01')
  })

  it('kirim saat belum lengkap dikembalikan ke halaman periksa', async () => {
    const t = await setup()
    const inv = await issue(t)
    const res = await t.post(`/f/${inv.token}/kirim`, {})
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/periksa')
  })
})

describe('halaman hasil (FR-16, FR-30)', () => {
  it('menampilkan skor, verdict, semua dimensi, dan rekomendasi', async () => {
    const t = await setup()
    const inv = await issue(t)
    await fillWithoutJs(t, inv.token)
    await t.post(`/f/${inv.token}/kirim`, {})
    const page = await (await t.get(`/f/${inv.token}/hasil`)).text()
    // "&" tampil sebagai &amp; karena semua teks di-escape; itu perilaku yang benar.
    for (const nama of ['Data', 'Teknologi &amp; Infrastruktur', 'Tata Kelola &amp; Kepatuhan']) {
      expect(page).toContain(nama)
    }
    expect(page).toContain('Dampak')
    expect(page).toContain('Usaha')
  })

  it('skor dimensi disertai angka, tidak bergantung warna saja (WCAG)', async () => {
    const t = await setup()
    const inv = await issue(t)
    await fillWithoutJs(t, inv.token)
    await t.post(`/f/${inv.token}/kirim`, {})
    const page = await (await t.get(`/f/${inv.token}/hasil`)).text()
    expect(page).toMatch(/<b>\d+(\.\d+)? · L\d<\/b>/)
  })

  it('tidak ada bagian yang diburamkan atau dikunci (FR-30)', async () => {
    const t = await setup()
    const inv = await issue(t)
    await fillWithoutJs(t, inv.token)
    await t.post(`/f/${inv.token}/kirim`, {})
    const page = await (await t.get(`/f/${inv.token}/hasil`)).text()
    expect(page.toLowerCase()).not.toContain('blur')
    expect(page.toLowerCase()).not.toContain('upgrade')
    expect(page.toLowerCase()).not.toContain('berlangganan')
  })

  it('membuka hasil sebelum kirim diarahkan ke halaman periksa', async () => {
    const t = await setup()
    const inv = await issue(t)
    const res = await t.get(`/f/${inv.token}/hasil`)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/periksa')
  })
})

describe('keamanan output', () => {
  it('nama perusahaan berisi HTML di-escape, bukan dieksekusi', async () => {
    const t = await setup()
    const jahat = await t.repo.createCompany({
      owner_auditor_id: t.auditor.id,
      name: '<script>alert(1)</script>PT Uji',
      industry: 'technology', employee_band: '10_49', country: 'ID',
    })
    const r = await t.api('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer user:${t.auditor.id}` },
      body: JSON.stringify({ company_id: jahat.id }),
    })
    const inv = await r.json()
    const page = await (await t.get(`/f/${inv.token}`)).text()
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;')
  })
})

describe('konversi nilai form ke AnswerValue', () => {
  it('memetakan tiap tipe pertanyaan dengan benar', () => {
    expect(toAnswerValue('single_choice', ['opt_75'])).toEqual({ choice: 'opt_75' })
    expect(toAnswerValue('multi_choice', ['a', 'b'])).toEqual({ choices: ['a', 'b'] })
    expect(toAnswerValue('scale_1_5', ['4'])).toEqual({ scale: 4 })
    expect(toAnswerValue('boolean', ['true'])).toEqual({ bool: true })
    expect(toAnswerValue('boolean', ['false'])).toEqual({ bool: false })
    expect(toAnswerValue('number', ['12'])).toEqual({ number: 12 })
  })

  it('menolak nilai yang tidak masuk akal, bukan mengarangnya', () => {
    expect(toAnswerValue('single_choice', [])).toBeNull()
    expect(toAnswerValue('scale_1_5', ['9'])).toBeNull()
    expect(toAnswerValue('scale_1_5', ['abc'])).toBeNull()
    expect(toAnswerValue('boolean', ['mungkin'])).toBeNull()
    expect(toAnswerValue('number', ['x'])).toBeNull()
  })

  it('multi_choice kosong tetap valid: artinya tidak memilih apa pun', () => {
    expect(toAnswerValue('multi_choice', [])).toEqual({ choices: [] })
  })
})
