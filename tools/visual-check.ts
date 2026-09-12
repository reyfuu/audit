/**
 * Verifikasi visual di viewport HP sungguhan memakai Playwright.
 *
 * Memeriksa hal yang tidak dapat dibuktikan oleh uji HTML string:
 * ukuran target sentuh terhitung, tidak ada scroll horizontal, tombol berada
 * dalam jangkauan, dan alur benar-benar dapat diselesaikan dengan mengetuk.
 *
 * Jalankan: bun tools/visual-check.ts
 */
import { chromium, devices } from 'playwright'
import { createApp } from '../apps/api/src/app'
import { createWeb } from '../apps/web/src/web'

const API_PORT = 3101
const WEB_PORT = 3100
const WEB_BASE = `http://localhost:${WEB_PORT}`

const { app: api, repo } = createApp({ baseUrl: WEB_BASE })
api.listen(API_PORT)
const web = createWeb({
  api: (p, init) => api.handle(new Request(`http://localhost:${API_PORT}${p}`, init)),
})
web.listen(WEB_PORT)

const auditor = repo.createAuditor({ email: 'd@x.id', name: 'Dimas Auditor', role: 'auditor' })
const company = repo.createCompany({
  owner_auditor_id: auditor.id, name: 'PT Maju Jaya Retail',
  industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
})
const inv = await (await api.handle(new Request(`http://localhost:${API_PORT}/invitations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer user:${auditor.id}` },
  body: JSON.stringify({ company_id: company.id }),
}))).json() as { token: string }

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
const inv2 = await (await api.handle(new Request(`http://localhost:${API_PORT}/invitations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer user:${auditor.id}` },
  body: JSON.stringify({
    company_id: repo.createCompany({
      owner_auditor_id: auditor.id, name: 'CV Tanpa JS',
      industry: 'fnb', employee_band: '10_49', country: 'ID',
    }).id,
  }),
}))).json() as { token: string }

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

await browser.close()

const gagal = results.filter((r) => !r.ok)
console.log(`\n${results.length - gagal.length}/${results.length} pemeriksaan visual lulus`)
console.log('Tangkapan layar: /tmp/siapai-*.png')
process.exit(gagal.length ? 1 : 0)
