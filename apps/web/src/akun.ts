/**
 * Halaman akun dan tim auditor (FR-02, FR-04).
 *
 * Ada dua jalur masuk yang harus lengkap, bukan hanya satu:
 *  - auditor lama masuk dengan kata sandi;
 *  - auditor yang baru diundang belum punya kata sandi sama sekali, sehingga ia
 *    masuk lewat kode sekali pakai yang dikirim ke emailnya, lalu menetapkan
 *    kata sandi dari halaman akun.
 *
 * Tanpa jalur kedua, mengundang anggota tim menjadi jalan buntu.
 */
import { Elysia, t } from 'elysia'
import { sessionPlugin, secureDari, type RawApi } from './auth-guard'
import { cookieSesi } from './session'
import { ICONS } from './icons'
import { PASSWORD_SCRIPT, passwordField } from './password-field'
import { esc, html, plainPage, redirect, shell } from './shell'

export interface AkunDeps {
  raw: RawApi
  publicBase: string
}

export function kodePage(d: {
  email?: string
  challengeId?: string
  error?: string
  info?: string
} = {}): string {
  return plainPage('Masuk dengan kode — SiapAI', `
<div class="card">
  <div class="login-brand"><span class="logo-mark" aria-hidden="true">S</span>
    <span>SiapAI</span></div>
  <h1 style="font-size:22px">Masuk dengan kode</h1>
  ${d.error
    ? `<div class="banner banner-error" role="alert">${ICONS.awas}<span>${esc(d.error)}</span></div>`
    : ''}
  ${d.info ? `<div class="banner banner-ok">${ICONS.ok}<span>${esc(d.info)}</span></div>` : ''}
  ${d.challengeId
    ? `<p class="muted">Kami mengirim kode 6 digit ke ${esc(d.email)}.
         Kode berlaku 10 menit.</p>
       <form method="post" action="/masuk/kode/verifikasi">
         <input type="hidden" name="challenge_id" value="${esc(d.challengeId)}">
         <input type="hidden" name="email" value="${esc(d.email ?? '')}">
         <label class="lbl" for="code">Kode dari email</label>
         <input class="field" id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
                pattern="[0-9]{6}" maxlength="6" required placeholder="123456">
         <button class="btn btn-primary btn-icon" type="submit" style="width:100%">
           ${ICONS.keluar}Masuk</button>
       </form>
       <p class="muted" style="margin-top:16px">
         Tidak menerima kode? <a href="/masuk/kode">Minta ulang</a>.</p>`
    : `<p class="muted">Untuk auditor yang baru diundang dan belum menetapkan
         kata sandi. Kami kirimkan kode sekali pakai ke email Anda.</p>
       <form method="post" action="/masuk/kode">
         <label class="lbl" for="email">Email</label>
         <input class="field" id="email" name="email" type="email" required
                autocomplete="username" inputmode="email" value="${esc(d.email ?? '')}"
                placeholder="nama@perusahaan.id">
         <button class="btn btn-primary btn-icon" type="submit" style="width:100%">
           ${ICONS.undangan}Kirim kode</button>
       </form>`}
  <p class="muted" style="margin-top:16px">
    Sudah punya kata sandi? <a href="/">Masuk dengan kata sandi</a>.</p>
</div>`)
}

export function akunModule({ raw, publicBase }: AkunDeps) {
  const secure = secureDari(publicBase)

  return new Elysia()
    .use(sessionPlugin({ raw, publicBase }))

    // ── Masuk dengan kode sekali pakai (FR-01), untuk auditor yang diundang
    .get('/masuk/kode', () => html(kodePage()))

    .post('/masuk/kode', async ({ body }) => {
      const f = body as Record<string, string>
      const email = String(f.email ?? '').trim()
      const res = await raw('/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) return html(kodePage({ email, error: 'Email tidak valid' }), 422)
      const { challenge_id } = await res.json() as { challenge_id: string }
      // Selalu tampilkan layar kode, walau email tidak terdaftar: halaman ini
      // tidak boleh menjadi alat memeriksa siapa yang menjadi auditor.
      return html(kodePage({ email, challengeId: challenge_id }))
    }, { body: t.Any() })

    .post('/masuk/kode/verifikasi', async ({ body }) => {
      const f = body as Record<string, string>
      const res = await raw('/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challenge_id: String(f.challenge_id ?? ''),
          code: String(f.code ?? ''),
        }),
      })
      if (!res.ok) {
        return html(kodePage({
          email: f.email ?? '',
          challengeId: String(f.challenge_id ?? ''),
          error: 'Kode tidak valid atau sudah kedaluwarsa',
        }), 401)
      }
      const sesi = await res.json() as { access_token: string; refresh_token: string }
      // Diarahkan ke halaman akun: yang masuk lewat kode biasanya belum punya
      // kata sandi, dan di sanalah ia dapat menetapkannya.
      return redirect('/app/akun', cookieSesi(
        { access: sesi.access_token, refresh: sesi.refresh_token }, { secure },
      ))
    }, { body: t.Any() })

    // ── Halaman akun: kata sandi dan anggota tim
    .get('/app/akun', async ({ sesi, query }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const me = await (await s.api('/auth/me')).json() as Me
      const bolehMengundang = me.role === 'auditor_admin' || me.role === 'sysadmin'

      return html(shell({
        title: 'Akun — SiapAI', active: '/app/akun', email: me.email,
        script: PASSWORD_SCRIPT,
        body: `
<div class="page-head"><h1>Akun</h1></div>

${query.ok === 'profil'
  ? `<div class="banner banner-ok" role="status">${ICONS.ok}<span>Profil diperbarui.</span></div>` : ''}
${query.ok === 'sandi'
  ? `<div class="banner banner-ok" role="status">${ICONS.ok}<span>Kata sandi berhasil disimpan.</span></div>` : ''}
${query.ok === 'undang'
  ? `<div class="banner banner-ok" role="status">${ICONS.ok}<span>Undangan dibuat.
      Anggota baru masuk lewat "Masuk dengan kode".</span></div>` : ''}
${query.gagal
  ? `<div class="banner banner-error" role="alert">${ICONS.awas}<span>${esc(query.gagal)}</span></div>` : ''}

<div class="card">
  <h2>Profil</h2>
  <p class="muted">Peran Anda: ${esc(me.role)}. Email juga dipakai untuk masuk,
     jadi mengubahnya berarti mengubah kredensial Anda.</p>
  <form method="post" action="/app/akun/profil" style="max-width:420px">
    <label class="lbl" for="nm">Nama</label>
    <input class="field" id="nm" name="name" required minlength="2" maxlength="120"
           value="${esc(me.name)}" style="width:100%;margin-bottom:12px">
    <label class="lbl" for="em2">Email</label>
    <input class="field" id="em2" name="email" type="email" required
           value="${esc(me.email)}" style="width:100%;margin-bottom:12px">
    <button class="btn btn-primary btn-sm btn-icon" type="submit">
      ${ICONS.ok}Simpan profil</button>
  </form>
</div>

<div class="card">
  <h2>Kata sandi</h2>
  <form method="post" action="/app/akun/sandi" style="max-width:420px">
    ${passwordField({
      id: 'cur', name: 'current_password', label: 'Kata sandi saat ini',
      autocomplete: 'current-password',
      hint: 'Kosongkan bila Anda belum pernah menetapkan kata sandi.',
    })}
    ${passwordField({
      id: 'new', name: 'new_password', label: 'Kata sandi baru',
      autocomplete: 'new-password', required: true, minlength: 10,
      hint: 'Minimal 10 karakter.',
    })}
    <button class="btn btn-primary btn-sm btn-icon" type="submit">
      ${ICONS.ok}Simpan kata sandi</button>
  </form>
</div>

${bolehMengundang
  ? `<div class="card">
      <h2>Undang anggota tim</h2>
      <p class="muted">Undangan berlaku 7 hari. Anggota baru masuk lewat
         <a href="/masuk/kode">Masuk dengan kode</a>, lalu menetapkan kata sandinya sendiri.</p>
      <form method="post" action="/app/akun/undang" style="max-width:420px">
        <label class="lbl" for="em">Email anggota</label>
        <input class="field" id="em" name="email" type="email" required
               placeholder="rekan@perusahaan.id" style="width:100%;margin-bottom:12px">
        <label class="lbl" for="rl">Peran</label>
        <select class="field" id="rl" name="role" style="width:100%;margin-bottom:12px">
          <option value="auditor">Auditor</option>
          <option value="auditor_admin">Admin auditor</option>
        </select>
        <button class="btn btn-sm btn-icon" type="submit">${ICONS.undangan}Kirim undangan</button>
      </form>
     </div>`
  : `<div class="card">
      <h2>Anggota tim</h2>
      <p class="muted">Hanya admin auditor yang dapat mengundang anggota baru.</p>
     </div>`}`,
      }), 200, s.cookiesBaru)
    }, { query: t.Object({ ok: t.Optional(t.String()), gagal: t.Optional(t.String()) }) })

    // ── FR-33 perbarui profil sendiri
    .post('/app/akun/profil', async ({ sesi, body }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const f = body as Record<string, string>
      const res = await s.api('/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: f.name ?? '', email: f.email ?? '' }),
      })
      if (res.ok) return redirect('/app/akun?ok=profil')
      const e = await res.json().catch(() => null) as { error?: { message?: string } } | null
      return redirect(`/app/akun?gagal=${
        encodeURIComponent(e?.error?.message ?? 'Profil tidak dapat disimpan')}`)
    }, { body: t.Any() })

    .post('/app/akun/sandi', async ({ sesi, body }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const f = body as Record<string, string>
      const res = await s.api('/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(f.current_password ? { current_password: f.current_password } : {}),
          new_password: String(f.new_password ?? ''),
        }),
      })
      if (res.ok) return redirect('/app/akun?ok=sandi')
      const e = await res.json().catch(() => null) as { error?: { message?: string } } | null
      return redirect(`/app/akun?gagal=${
        encodeURIComponent(e?.error?.message ?? 'Kata sandi tidak dapat disimpan')}`)
    }, { body: t.Any() })

    .post('/app/akun/undang', async ({ sesi, body }) => {
      const s = await sesi()
      if (!s) return redirect('/')
      const f = body as Record<string, string>
      const res = await s.api('/auth/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: f.email, role: f.role || 'auditor' }),
      })
      if (res.ok) return redirect('/app/akun?ok=undang')
      const e = await res.json().catch(() => null) as { error?: { message?: string } } | null
      return redirect(`/app/akun?gagal=${
        encodeURIComponent(e?.error?.message ?? 'Undangan gagal dibuat')}`)
    }, { body: t.Any() })
}

interface Me { id: string; email: string; name: string; role: string }
