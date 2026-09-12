/**
 * Kerangka halaman dashboard auditor: sidebar tetap + area konten.
 *
 * Dipisah dari modul rute agar setiap halaman hanya memikirkan isinya, dan
 * navigasi tidak pernah berbeda-beda antar halaman.
 */
import { ICONS, type IconName } from './icons'
import { STYLES, APP_STYLES } from './styles'

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export interface NavItem {
  href: string
  label: string
  icon: IconName
}

export const NAV: NavItem[] = [
  { href: '/app', label: 'Ringkasan', icon: 'ringkasan' },
  { href: '/app/undangan', label: 'Undangan', icon: 'undangan' },
  { href: '/app/perusahaan', label: 'Perusahaan', icon: 'perusahaan' },
  { href: '/app/tinjauan', label: 'Tinjauan AI', icon: 'tinjauan' },
  { href: '/app/akun', label: 'Akun & tim', icon: 'akun' },
]

/** Lencana merek: inisial dalam kotak, agar sidebar punya jangkar visual. */
const LOGO = `<span class="logo-mark" aria-hidden="true">S</span>`

function head(title: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLES}${APP_STYLES}</style>`
}

/**
 * Halaman dashboard dengan sidebar.
 * `active` adalah href item navigasi yang sedang dibuka; dipakai untuk
 * `aria-current` sehingga pembaca layar juga tahu posisi pengguna.
 */
export function shell(d: {
  title: string
  active: string
  email?: string
  body: string
  /** Skrip peningkatan progresif; halaman tetap berfungsi tanpanya. */
  script?: string
}): string {
  const nav = NAV.map((n) => `<a class="nav" href="${n.href}"${
    n.href === d.active ? ' aria-current="page"' : ''
  }><span class="ic">${ICONS[n.icon]}</span>${esc(n.label)}</a>`).join('')

  return `<!doctype html><html lang="id"><head>${head(d.title)}</head><body>
<div class="shell">
  <nav class="side" aria-label="Navigasi utama">
    <a class="logo" href="/app">${LOGO}<span>SiapAI</span></a>
    ${nav}
    <div class="sep">
      ${d.email ? `<div class="who">${esc(d.email)}</div>` : ''}
      <form method="post" action="/keluar" style="margin:0">
        <button class="btn btn-sm btn-icon" type="submit" style="width:100%">
          ${ICONS.keluar}Keluar</button>
      </form>
    </div>
  </nav>
  <main class="main"><div class="inner">${d.body}</div></main>
</div>
${d.script ? `<script>${d.script}</script>` : ''}
</body></html>`
}

/** Halaman tanpa sidebar, untuk masuk dan pesan yang berdiri sendiri. */
export function plainPage(title: string, body: string, script?: string): string {
  return `<!doctype html><html lang="id"><head>${head(title)}</head><body>
<div class="login-wrap">${body}</div>
${script ? `<script>${script}</script>` : ''}
</body></html>`
}

export const html = (body: string, status = 200, cookies: string[] = []) => {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-store',
  })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(body, { status, headers })
}

export const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ location: to })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 303, headers })
}
