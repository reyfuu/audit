/**
 * Design token dan gaya form responden.
 *
 * Mobile-first sesuai PRD §9: layout dasar ditulis untuk layar kecil,
 * media query hanya menambah kenyamanan di layar besar.
 */
export const STYLES = `
:root {
  --brand-900:#0B2E4F; --brand-600:#1467B3; --brand-300:#7FB3E3;
  --ok:#1B9E5A; --warn:#E8A317; --danger:#D64545;
  --bg:#F7F9FC; --surface:#FFFFFF; --border:#E3E8EF;
  --text:#111827; --muted:#5B6472;
  --l1:#D64545; --l2:#E8734A; --l3:#E8A317; --l4:#7BB661; --l5:#1B9E5A;
  --radius:8px; --shadow-sm:0 1px 2px rgba(16,24,40,.06);
  --shadow-md:0 4px 12px rgba(16,24,40,.08);
}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body {
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  background:var(--bg); color:var(--text);
  /* 16px: di bawah ini iOS melakukan zoom otomatis saat input difokuskan (PRD §9) */
  font-size:16px; line-height:1.6;
  -webkit-text-size-adjust:100%;
}
.wrap { max-width:680px; margin:0 auto; padding:16px 16px 120px; }

header.bar {
  position:sticky; top:0; z-index:10;
  background:var(--surface); border-bottom:1px solid var(--border);
  padding:12px 16px; display:flex; align-items:center; gap:12px;
}
.bar .brand { font-weight:600; color:var(--brand-900); font-size:15px; }
.bar .save { margin-left:auto; font-size:13px; color:var(--muted); }
.bar .save[data-state="saving"] { color:var(--warn); }
.bar .save[data-state="saved"] { color:var(--ok); }
.bar .save[data-state="error"] { color:var(--danger); }

.progress { height:6px; background:var(--border); border-radius:999px; overflow:hidden; }
.progress > i { display:block; height:100%; background:var(--brand-600); transition:width .3s ease; }
.progress-meta { display:flex; justify-content:space-between;
  font-size:13px; color:var(--muted); margin:8px 0 4px; }

.card { background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); box-shadow:var(--shadow-sm); padding:20px; margin-bottom:16px; }

h1 { font-size:24px; line-height:1.3; margin:0 0 8px; }
h2 { font-size:19px; line-height:1.35; margin:0 0 4px; }
.eyebrow { font-size:13px; color:var(--brand-600); font-weight:600;
  text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px; }
.muted { color:var(--muted); font-size:14px; }

fieldset { border:0; margin:0; padding:0; }
legend { font-size:18px; line-height:1.4; font-weight:600; margin-bottom:4px; padding:0; }
.help { background:#F0F5FB; border-left:3px solid var(--brand-300);
  padding:10px 12px; border-radius:6px; font-size:14px; color:var(--muted); margin:12px 0; }

.opt { display:flex; gap:12px; align-items:flex-start;
  border:1px solid var(--border); border-radius:var(--radius);
  padding:14px; margin-bottom:8px; cursor:pointer;
  /* 44px: target sentuh minimum yang nyaman untuk ibu jari (PRD §9) */
  min-height:44px; background:var(--surface); transition:border-color .15s, background .15s; }
.opt:hover { border-color:var(--brand-300); }
.opt:focus-within { outline:2px solid var(--brand-600); outline-offset:2px; }
.opt input { width:22px; height:22px; margin:1px 0 0; flex:none; accent-color:var(--brand-600); }
.opt input:checked ~ span { font-weight:600; }
.opt:has(input:checked) { border-color:var(--brand-600); background:#F2F7FD; }

.actions { position:fixed; left:0; right:0; bottom:0;
  background:var(--surface); border-top:1px solid var(--border);
  padding:12px 16px calc(12px + env(safe-area-inset-bottom));
  display:flex; gap:12px; }
.actions .inner { max-width:680px; margin:0 auto; display:flex; gap:12px; width:100%; }
.btn { flex:1; min-height:48px; border-radius:var(--radius); border:1px solid var(--border);
  background:var(--surface); color:var(--text); font-size:16px; font-weight:600;
  cursor:pointer; padding:0 16px; }
.btn-primary { background:var(--brand-600); border-color:var(--brand-600); color:#fff; }
.btn-primary:disabled { background:var(--border); border-color:var(--border); color:var(--muted); cursor:not-allowed; }
.btn:focus-visible { outline:2px solid var(--brand-900); outline-offset:2px; }

.banner { border-radius:var(--radius); padding:12px 14px; margin-bottom:16px; font-size:14px; }
.banner-warn { background:#FDF6E7; border:1px solid var(--warn); }
.banner-error { background:#FBEAEA; border:1px solid var(--danger); }
.banner-ok { background:#EAF7F0; border:1px solid var(--ok); }

.verdict { text-align:center; padding:24px 20px; }
.verdict .score { font-size:56px; font-weight:700; line-height:1; margin:8px 0; }
.verdict .label { font-size:20px; font-weight:600; }
.v-READY { color:var(--ok); } .v-CONDITIONALLY_READY { color:var(--warn); } .v-NOT_READY { color:var(--danger); }

.dim { margin-bottom:14px; }
.dim-head { display:flex; justify-content:space-between; font-size:15px; margin-bottom:6px; }
.dim-head b { font-variant-numeric:tabular-nums; }
.meter { height:10px; background:var(--border); border-radius:999px; overflow:hidden; }
.meter > i { display:block; height:100%; border-radius:999px; }

.rec { border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:12px; }
.rec h3 { font-size:16px; margin:0 0 6px; }
.rec .tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.tag { font-size:12px; background:var(--bg); border:1px solid var(--border);
  border-radius:999px; padding:3px 10px; color:var(--muted); }

.missing-list a { display:block; padding:10px 0; border-bottom:1px solid var(--border);
  color:var(--brand-600); min-height:44px; }

.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }

@media (min-width:768px) {
  .wrap { padding:24px 24px 120px; }
  h1 { font-size:30px; }
}
@media (prefers-reduced-motion:reduce) {
  * { transition:none !important; animation:none !important; }
}
`
