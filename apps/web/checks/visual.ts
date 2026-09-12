/**
 * Verifikasi visual di viewport HP sungguhan memakai Playwright.
 *
 * Memeriksa hal yang tidak dapat dibuktikan oleh uji HTML string:
 * ukuran target sentuh terhitung, tidak ada scroll horizontal, tombol berada
 * dalam jangkauan, dan alur benar-benar dapat diselesaikan dengan mengetuk.
 *
 * Jalankan: bun run check:visual
 */
import { chromium, devices } from 'playwright'
import { createApp } from '../../api/src/app'
import { createWebApp } from '../src/app'
import { hashPassword } from '../../api/src/lib/auth'

/**
 * Alat ini memakai alur login sungguhan, bukan token pintasan: browser benar-benar
 * mengisi halaman /masuk, sehingga kerusakan pada sesi ikut ketahuan di sini.
 */
const SANDI = 'sandiVisual123'

const API_PORT = 3101
const WEB_PORT = 3100
const WEB_BASE = `http://localhost:${WEB_PORT}`

const { app: api, repo } = createApp({ baseUrl: WEB_BASE })
api.listen(API_PORT)
const raw = (p: string, init: RequestInit = {}, token?: string) =>
  api.handle(new Request(`http://localhost:${API_PORT}${p}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }))

const auditor = await repo.createAuditor({
  email: 'd@x.id', name: 'Dimas Auditor', role: 'auditor', password_hash: hashPassword(SANDI),
})

/** Login kata sandi, persis seperti auditor sungguhan. */
const TOKEN = await (async () => {
  const res = await raw('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: auditor.email, password: SANDI }),
  })
  return (await res.json() as { access_token: string }).access_token
})()

// Dashboard auditor ikut disajikan agar pemeriksaan visual mencakup
// seluruh permukaan produk, bukan hanya form responden.
createWebApp({ raw, publicBase: WEB_BASE }).listen(WEB_PORT)

const company = await repo.createCompany({
  owner_auditor_id: auditor.id, name: 'PT Maju Jaya Retail',
  industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
})
const inv = await (await raw('/invitations', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ company_id: company.id }),
}, TOKEN)).json() as { token?: string; error?: { message?: string } }

if (!inv.token) {
  console.error('Gagal menerbitkan undangan:', JSON.stringify(inv))
  process.exit(1)
}

const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}\n        ${detail}`)
}

const browser = await chromium.launch()

// ── iPhone 13: jalur masuk utama setelah memindai QR
const iphone = await browser.newContext({ ...devices['iPhone 13'] })
const page = await iphone.newPage()

await page.goto(`${WEB_BASE}/f/${inv.token}`, { waitUntil: 'networkidle' })
await page.screenshot({ path: '/tmp/siapai-1-sambutan.png', fullPage: true })

const vw = page.viewportSize()!.width
const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
check('Tidak ada scroll horizontal di HP', scrollW <= vw + 1,
  `viewport ${vw}px, konten ${scrollW}px`)

check('Nama perusahaan terlihat',
  await page.getByText('PT Maju Jaya Retail').isVisible(), 'judul tampil')

// Tombol utama harus dalam jangkauan ibu jari, yakni di paruh bawah layar.
const cta = page.getByRole('link', { name: /Mulai isi/ })
const box = (await cta.boundingBox())!
const vh = page.viewportSize()!.height
check('Tombol utama dalam jangkauan ibu jari', box.y > vh * 0.5,
  `tombol di y=${Math.round(box.y)}, tinggi layar ${vh}px`)
check('Tinggi tombol utama >= 44px', box.height >= 44, `${Math.round(box.height)}px`)

await cta.click()
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/siapai-2-pertanyaan.png', fullPage: true })

// Target sentuh opsi, diukur dari layout sungguhan.
const optBoxes = await page.locator('.opt').evaluateAll((els) =>
  els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } }))
const minH = Math.min(...optBoxes.map((b) => b.h))
check('Semua target sentuh opsi >= 44px', minH >= 44,
  `${optBoxes.length} opsi, terkecil ${Math.round(minH)}px`)

const fontSize = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.body).fontSize))
check('Ukuran teks dasar >= 16px (cegah zoom iOS)', fontSize >= 16, `${fontSize}px`)

// Satu pertanyaan per layar.
const legends = await page.locator('legend').count()
check('Satu pertanyaan per layar', legends === 1, `${legends} legend`)

// Kontras teks utama terhadap latar.
const contrast = await page.evaluate(() => {
  const lum = (c: string) => {
    const [r, g, b] = c.match(/\d+/g)!.slice(0, 3).map((v) => {
      const s = Number(v) / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const el = document.querySelector('legend')!
  const fg = lum(getComputedStyle(el).color)
  const bg = lum(getComputedStyle(document.querySelector('.card')!).backgroundColor)
  const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg]
  return (hi + 0.05) / (lo + 0.05)
})
check('Kontras teks pertanyaan >= 4.5:1 (WCAG AA)', contrast >= 4.5,
  `rasio ${contrast.toFixed(2)}:1`)

// Isi form dengan mengetuk, seperti pengguna sungguhan.
let taps = 0
for (let i = 0; i < 60; i++) {
  const opts = page.locator('.opt input')
  if (await opts.count() === 0) break
  await opts.last().click()
  taps++
  const lanjut = page.getByRole('button', { name: 'Lanjut' })
  if (await lanjut.count() === 0) break
  await lanjut.click()
  await page.waitForLoadState('networkidle')
  if (page.url().includes('/periksa')) break
}
check('Form dapat diselesaikan hanya dengan mengetuk', page.url().includes('/periksa'),
  `${taps} ketukan, berakhir di ${new URL(page.url()).pathname}`)

await page.screenshot({ path: '/tmp/siapai-3-periksa.png', fullPage: true })
check('Halaman periksa menyatakan siap kirim',
  await page.getByText('Semua pertanyaan sudah terjawab').isVisible(), 'banner tampil')

await page.getByRole('button', { name: 'Kirim jawaban' }).click()
await page.waitForLoadState('networkidle')
await page.getByRole('link', { name: 'Lihat hasil' }).click()
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/siapai-4-hasil.png', fullPage: true })

const skor = await page.locator('.verdict .score').textContent()
check('Halaman hasil menampilkan skor', Boolean(skor && Number(skor) > 0), `skor ${skor}`)
const dims = await page.locator('.dim').count()
check('Tujuh dimensi tampil di hasil', dims === 7, `${dims} dimensi`)
const recs = await page.locator('.rec').count()
check('Minimal 3 rekomendasi tampil', recs >= 3, `${recs} rekomendasi`)

const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth)
check('Halaman hasil tidak scroll horizontal', scrollW2 <= vw + 1,
  `viewport ${vw}px, konten ${scrollW2}px`)

// ── Tanpa JavaScript sama sekali
const noJs = await browser.newContext({ ...devices['iPhone 13'], javaScriptEnabled: false })
const p2 = await noJs.newPage()
const inv2 = await (await raw('/invitations', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    company_id: (await repo.createCompany({
      owner_auditor_id: auditor.id, name: 'CV Tanpa JS',
      industry: 'fnb', employee_band: '10_49', country: 'ID',
    })).id,
  }),
}, TOKEN)).json() as { token: string }

await p2.goto(`${WEB_BASE}/f/${inv2.token}/isi`)
await p2.locator('.opt input').last().click()
await p2.getByRole('button', { name: 'Lanjut' }).click()
await p2.waitForLoadState('load')
check('Form tetap berfungsi dengan JavaScript dimatikan',
  p2.url().includes('/isi'), `berpindah ke ${new URL(p2.url()).pathname}`)
const progressText = await p2.locator('.progress-meta').first().textContent()
check('Jawaban tersimpan tanpa JavaScript',
  /1 dari/.test(progressText ?? ''), progressText?.trim() ?? '')
await p2.screenshot({ path: '/tmp/siapai-5-tanpa-js.png', fullPage: true })

// ── Layar kecil ekstrem
const kecil = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true })
const p3 = await kecil.newPage()
await p3.goto(`${WEB_BASE}/f/${inv2.token}/isi`)
const sw3 = await p3.evaluate(() => document.documentElement.scrollWidth)
check('Tetap rapi di layar 320px', sw3 <= 321, `konten ${sw3}px`)
await p3.screenshot({ path: '/tmp/siapai-6-320px.png', fullPage: true })

// ── Dashboard auditor di layar laptop
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const p4 = await desktop.newPage()

// Masuk lewat halaman login sungguhan; ini juga menguji cookie sesi.
await p4.goto(`${WEB_BASE}/app`, { waitUntil: 'networkidle' })
check('Dashboard mengarahkan pengunjung tanpa sesi ke halaman masuk',
  p4.url().includes('/masuk'), `berakhir di ${new URL(p4.url()).pathname}`)
await p4.fill('#email', auditor.email)
await p4.fill('#password', SANDI)
await p4.getByRole('button', { name: 'Masuk' }).click()
await p4.waitForLoadState('networkidle')
check('Login membawa auditor ke dashboard',
  p4.url().includes('/app'), `berakhir di ${new URL(p4.url()).pathname}`)
await p4.screenshot({ path: '/tmp/siapai-10-masuk.png', fullPage: true })

const sidebarItems = await p4.locator('.side a.nav').count()
check('Sidebar navigasi tampil di dashboard', sidebarItems >= 5,
  `${sidebarItems} item navigasi`)

// Ikon harus benar-benar terender dengan ukuran nyata, bukan kotak kosong.
const ikonBox = await p4.locator('.side svg.icon').evaluateAll((els) =>
  els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) }))
check('Semua ikon sidebar terender dengan ukuran nyata',
  ikonBox.length >= 5 && Math.min(...ikonBox) >= 16,
  `${ikonBox.length} ikon, terkecil ${Math.round(Math.min(...ikonBox))}px`)

// Ikon mengikuti warna keadaan aktif, sehingga halaman yang dibuka terbaca.
const warnaAktif = await p4.evaluate(() => {
  const aktif = document.querySelector('.side a.nav[aria-current="page"] .ic')
  const diam = document.querySelector('.side a.nav:not([aria-current]) .ic')
  return [getComputedStyle(aktif!).color, getComputedStyle(diam!).color]
})
check('Ikon halaman aktif berbeda warna dari yang tidak aktif',
  warnaAktif[0] !== warnaAktif[1], `aktif ${warnaAktif[0]}, diam ${warnaAktif[1]}`)

// Target sentuh item navigasi, diukur dari layout sungguhan.
const navBox = await p4.locator('.side a.nav').evaluateAll((els) =>
  els.map((e) => e.getBoundingClientRect().height))
check('Target sentuh navigasi >= 44px', Math.min(...navBox) >= 44,
  `terkecil ${Math.round(Math.min(...navBox))}px`)

// Halaman akun adalah jalan keluar dari undangan tim; pastikan benar-benar ada.
await p4.goto(`${WEB_BASE}/app/akun`, { waitUntil: 'networkidle' })
check('Halaman akun menyediakan penetapan kata sandi',
  await p4.locator('#new').isVisible(), 'formulir kata sandi tampil')
await p4.screenshot({ path: '/tmp/siapai-11-akun.png', fullPage: true })

const kodePage = await desktop.newPage()
await kodePage.goto(`${WEB_BASE}/masuk/kode`, { waitUntil: 'networkidle' })
check('Jalur masuk dengan kode tersedia untuk anggota yang baru diundang',
  await kodePage.locator('#email').isVisible(), 'formulir kode tampil')
await kodePage.close()

await p4.goto(`${WEB_BASE}/app/undangan`, { waitUntil: 'networkidle' })

// Tabel di ponsel: barisnya menjadi kartu, tanpa teks yang terpotong sempit.
const hp = await browser.newContext({ ...devices['iPhone 13'] })
await hp.addCookies(await desktop.cookies())
const p6 = await hp.newPage()
await p6.goto(`${WEB_BASE}/app/undangan`, { waitUntil: 'networkidle' })
await p6.screenshot({ path: '/tmp/siapai-12-tabel-hp.png', fullPage: true })
const kolomHp = await p6.evaluate(() =>
  getComputedStyle(document.querySelector('.tbl td')!).display)
check('Tabel berubah menjadi kartu di layar ponsel', kolomHp !== 'table-cell',
  `display sel: ${kolomHp}`)
check('Daftar undangan di ponsel tidak scroll horizontal',
  await p6.evaluate(() => document.documentElement.scrollWidth) <= 391,
  `konten ${await p6.evaluate(() => document.documentElement.scrollWidth)}px`)
await p6.close()
await p4.screenshot({ path: '/tmp/siapai-7-dashboard.png', fullPage: true })

check('Dashboard menampilkan daftar undangan',
  await p4.getByText('Undangan audit').isVisible(), 'judul tampil')
check('Status undangan terbaca manusia',
  (await p4.locator('.pill').count()) > 0,
  `${await p4.locator('.pill').count()} label status`)

// Pilih undangan yang benar-benar sudah selesai. Mengambil yang pertama saja
// rapuh: urutan daftar mengikuti waktu terbit, bukan status.
const tautanUndangan = await p4.locator('a[href^="/app/undangan/"]').evaluateAll(
  (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!))
let detailDipilih = tautanUndangan[0]!
for (const href of tautanUndangan) {
  await p4.goto(`${WEB_BASE}${href}`, { waitUntil: 'networkidle' })
  if (await p4.getByText('Hasil sudah tersedia').count() > 0) { detailDipilih = href; break }
}
await p4.goto(`${WEB_BASE}${detailDipilih}`, { waitUntil: 'networkidle' })
await p4.screenshot({ path: '/tmp/siapai-8-detail.png', fullPage: true })

const qr = p4.locator('img.qr')
check('QR tampil di halaman detail', await qr.isVisible(), 'gambar QR ada')
const qrBox = await qr.boundingBox()
check('QR cukup besar untuk dipindai dari layar',
  Boolean(qrBox && qrBox.width >= 150),
  `${Math.round(qrBox?.width ?? 0)}px`)

const punyaHasil = await p4.getByText('Hasil sudah tersedia').count() > 0
check('Halaman detail menampilkan blok hasil untuk audit yang selesai',
  punyaHasil, punyaHasil ? 'blok hasil tampil' : 'belum selesai, dilewati')

if (punyaHasil) {
  // Tautan bagikan dibuat lewat tombol, seperti auditor sungguhan.
  await p4.getByRole('button', { name: 'Buat tautan bagikan' }).click()
  await p4.waitForLoadState('networkidle')
  const kotak = await p4.locator('.copybox').last().textContent()
  const urlBagikan = (kotak ?? '').trim()
  check('Tombol buat tautan bagikan menghasilkan URL',
    /\/l\/[A-Za-z0-9_-]{20,}/.test(urlBagikan), urlBagikan.slice(0, 48))

  // Laporan dibuka di konteks tanpa sesi auditor sama sekali.
  const anonim = await browser.newContext()
  const p5 = await anonim.newPage()
  await p5.goto(urlBagikan, { waitUntil: 'networkidle' })
  await p5.screenshot({ path: '/tmp/siapai-9-bagikan.png', fullPage: true })
  check('Laporan yang dibagikan terbuka tanpa akun',
    (await p5.locator('.verdict .score').count()) > 0,
    `skor: ${await p5.locator('.verdict .score').textContent()}`)
  check('Laporan bagikan memuat ketujuh dimensi',
    await p5.locator('.dim').count() === 7,
    `${await p5.locator('.dim').count()} dimensi`)
  await anonim.close()
}

await browser.close()

const gagal = results.filter((r) => !r.ok)
console.log(`\n${results.length - gagal.length}/${results.length} pemeriksaan visual lulus`)
console.log('Tangkapan layar: /tmp/siapai-*.png')
process.exit(gagal.length ? 1 : 0)
