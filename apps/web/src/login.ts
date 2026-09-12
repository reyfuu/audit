/**
 * Halaman masuk auditor (FR-02).
 *
 * Hanya email + kata sandi. Tidak ada login pihak ketiga: satu jalur yang
 * dikuasai penuh lebih mudah dijaga daripada dua jalur setengah jadi, dan
 * auditor tidak selalu punya akun Google kantor.
 */
import { Elysia, t } from 'elysia'
import type { RawApi } from './auth-guard'
import { secureDari, sessionApi } from './auth-guard'
import { cookieHapus, cookieSesi, sesiDari } from './session'
import { ICONS } from './icons'
import { esc, html, plainPage, redirect } from './shell'

export interface LoginDeps {
  raw: RawApi
  publicBase: string
}

export function loginPage(d: { error?: string; email?: string } = {}): string {
  return plainPage('Masuk — SiapAI', `
<div class="card">
  <div class="login-brand"><span class="logo-mark" aria-hidden="true">S</span>
    <span>SiapAI</span></div>
  <h1 style="font-size:22px">Masuk sebagai auditor</h1>
  <p class="muted">Gunakan email dan kata sandi akun auditor Anda.</p>
  ${d.error
    ? `<div class="banner banner-error" role="alert">${ICONS.awas}<span>${esc(d.error)}</span></div>`
    : ''}
  <form method="post" action="/masuk">
    <label class="lbl" for="email">Email</label>
    <input class="field" id="email" name="email" type="email" required autocomplete="username"
           inputmode="email" value="${esc(d.email ?? '')}" placeholder="nama@perusahaan.id">
    <label class="lbl" for="password">Kata sandi</label>
    <input class="field" id="password" name="password" type="password" required
           autocomplete="current-password" placeholder="Kata sandi">
    <button class="btn btn-primary btn-icon" type="submit" style="width:100%">
      ${ICONS.keluar}Masuk</button>
  </form>
  <p class="muted" style="margin-top:16px">
    Baru diundang dan belum punya kata sandi?
    <a href="/masuk/kode">Masuk dengan kode lewat email</a>.
  </p>
  <p class="muted">Akun auditor hanya dibuat lewat undangan admin tim Anda.</p>
</div>`)
}

export function loginModule({ raw, publicBase }: LoginDeps) {
  const secure = secureDari(publicBase)

  return new Elysia()
    .get('/masuk', async ({ headers }) => {
      /*
       * Sudah masuk: jangan paksa login ulang.
       *
       * Keberadaan cookie saja TIDAK cukup untuk menyimpulkan itu. Cookie yang
       * tertinggal dari proses demo sebelumnya masih ada di peramban, tetapi
       * sesinya sudah mati bersama penyimpanan di memori. Dulu halaman ini
       * mengarahkan ke /app, /app mendapati sesinya tidak sah dan mengarahkan
       * balik ke sini, dan peramban berputar sampai menyerah dengan
       * ERR_TOO_MANY_REDIRECTS.
       *
       * Karena itu sesinya benar-benar diverifikasi. Bila tidak sah, cookie
       * basi dibuang sekalian supaya keadaan ini tidak berulang.
       */
      if (sesiDari(headers.cookie)) {
        const aktif = await sessionApi(raw, headers.cookie, secure)
        if (aktif) return redirect('/app')
        return html(loginPage(), 200, cookieHapus({ secure }))
      }
      return html(loginPage())
    })

    .post('/masuk', async ({ body }) => {
      const f = body as Record<string, string>
      const email = String(f.email ?? '').trim()
      const res = await raw('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: String(f.password ?? '') }),
      })
      if (!res.ok) {
        // Pesan seragam: halaman ini tidak boleh mengungkap email mana yang ada.
        return html(loginPage({ error: 'Email atau kata sandi salah', email }), 401)
      }
      const sesi = await res.json() as { access_token: string; refresh_token: string }
      return redirect('/app', cookieSesi(
        { access: sesi.access_token, refresh: sesi.refresh_token }, { secure },
      ))
    }, { body: t.Any() })

    .post('/keluar', async ({ headers }) => {
      const sesi = sesiDari(headers.cookie)
      // Cabut di server juga, bukan sekadar membuang cookie di peramban.
      if (sesi) {
        await raw('/auth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: sesi.refresh }),
        })
      }
      return redirect('/masuk', cookieHapus({ secure }))
    })
}
