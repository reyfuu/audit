/**
 * Kerangka halaman dashboard auditor: sidebar tetap + area konten.
 *
 * Dipisah dari modul rute agar setiap halaman hanya memikirkan isinya, dan
 * navigasi tidak pernah berbeda-beda antar halaman.
 */
import { STYLES, APP_STYLES } from './styles'

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export interface NavItem {
  href: string
  label: string
  icon: string
}

export const NAV: NavItem[] = [
  { href: '/app', label: 'Ringkasan', icon: '▦' },
  { href: '/app/undangan', label: 'Undangan', icon: '✉' },
  { href: '/app/perusahaan', label: 'Perusahaan', icon: '🏢' },
  { href: '/app/tinjauan', label: 'Tinjauan AI', icon: '✦' },
]

function head(title: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLES}
.tbl { width:100%; border-collapse:collapse; }
.tbl th { text-align:left; font-size:13px; color:var(--muted); font-weight:600;
  padding:8px 6px; border-bottom:1px solid var(--border); }
.tbl td { padding:12px 6px; border-bottom:1px solid var(--border); font-size:15px; vertical-align:top; }
.pill { display:inline-block; font-size:12px; font-weight:600; padding:3px 10px;
  border-radius:999px; border:1px solid currentColor; }
.qr { display:block; width:180px; height:180px; border:1px solid var(--border);
  border-radius:var(--radius); background:#fff; }
.copybox { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px;
  background:var(--bg); border:1px solid var(--border); border-radius:6px;
  padding:10px; word-break:break-all; margin:8px 0; }
.grid { display:grid; gap:16px; }
@media (min-width:900px) { .grid-2 { grid-template-columns:1fr 1fr; } }
${APP_STYLES}</style>`
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
}): string {
  const nav = NAV.map((n) => `<a class="nav" href="${n.href}"${
    n.href === d.active ? ' aria-current="page"' : ''
  }><span class="ic" aria-hidden="true">${n.icon}</span>${esc(n.label)}</a>`).join('')

  return `<!doctype html><html lang="id"><head>${head(d.title)}</head><body>
<div class="shell">
  <nav class="side" aria-label="Navigasi utama">
    <div class="logo">SiapAI</div>
    ${nav}
    <div class="sep">
      ${d.email ? `<div class="who">${esc(d.email)}</div>` : ''}
      <form method="post" action="/keluar" style="margin:0">
        <button class="btn btn-sm" type="submit" style="width:100%">Keluar</button>
      </form>
    </div>
  </nav>
  <main class="main"><div class="inner">${d.body}</div></main>
</div>
</body></html>`
}

/** Halaman tanpa sidebar, untuk masuk dan pesan yang berdiri sendiri. */
export function plainPage(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head>${head(title)}</head><body>
<div class="login-wrap">${body}</div></body></html>`
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
