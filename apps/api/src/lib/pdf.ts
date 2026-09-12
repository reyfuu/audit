/**
 * Perender PDF berbasis Playwright (FR-17, ADR-005).
 *
 * Dipisahkan dari modul HTTP agar API tidak bergantung pada browser, dan agar
 * uji dapat menyuntikkan perender palsu. Browser dipakai ulang antar permintaan
 * karena menyalakannya butuh waktu lebih dari satu detik.
 */
import type { Browser } from 'playwright'

let browser: Browser | undefined

async function ambilBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  const { chromium } = await import('playwright')
  browser = await chromium.launch()
  return browser
}

export async function tutupPerender(): Promise<void> {
  await browser?.close()
  browser = undefined
}

/**
 * Merender halaman laporan menjadi PDF A4.
 *
 * `printBackground` wajib true: tanpa itu, meteran skor dan warna level hilang
 * sehingga PDF tidak lagi identik dengan tampilan layar.
 */
export async function renderPdf(url: string): Promise<ArrayBuffer> {
  const b = await ambilBrowser()
  const ctx = await b.newContext()
  try {
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    })
    const out = new ArrayBuffer(buf.byteLength)
    new Uint8Array(out).set(buf)
    return out
  } finally {
    await ctx.close()
  }
}
