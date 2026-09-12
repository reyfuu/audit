#!/usr/bin/env python3
"""Memverifikasi klaim di README benar-benar sesuai kenyataan.

Angka di README mudah basi setelah kode berubah. Skrip ini membandingkan klaim
tertulis dengan hasil perintah yang sebenarnya dijalankan, sehingga dokumentasi
tidak pernah menjanjikan lebih dari yang ada.

Jalankan: python3 tools/verify_readme.py
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
README = (ROOT / "README.md").read_text(encoding="utf-8")

hasil = []
def check(nama, ok, detail):
    hasil.append((nama, bool(ok), detail))

def jalankan(cmd):
    p = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True)
    return p.stdout + p.stderr

# ── 1. Jumlah uji yang diklaim per paket
out = jalankan("bun test packages apps 2>&1 | tail -12")
m = re.search(r"^\s*(\d+) pass", out, re.M)
total_nyata = int(m.group(1)) if m else 0
check("Suite uji berjalan tanpa kegagalan",
      " 0 fail" in out, f"{total_nyata} uji lulus")

for paket, perintah in [
    ("packages/scoring", "bun test packages/scoring"),
    ("apps/api", "bun test apps/api"),
    ("apps/web", "bun test apps/web"),
]:
    # tail lebih panjang: baris "skip" bisa menyela ringkasan
    o = jalankan(f"{perintah} 2>&1 | tail -10")
    mm = re.search(r"^\s*(\d+) pass", o, re.M)
    n = int(mm.group(1)) if mm else 0
    # README menyebut "Berjalan, N uji" atau "N/N lulus"
    diklaim = [int(x) for x in re.findall(rf"{re.escape(paket)}.*?(\d+) uji", README)]
    check(f"Jumlah uji {paket} tidak dilebihkan",
          not diklaim or max(diklaim) <= n,
          f"nyata={n}, diklaim={diklaim or 'tidak disebut'}")

# ── 2. Setiap perintah bun run yang disebut README benar-benar ada
pkg = (ROOT / "package.json").read_text()
scripts = set(re.findall(r'"([a-z:]+)":\s*"', pkg.split('"scripts"')[1].split("}")[0]))
disebut = set(re.findall(r"bun run ([a-z:]+)", README))
hilang = sorted(disebut - scripts)
check("Semua perintah `bun run` di README ada di package.json",
      not hilang, f"{len(disebut)} perintah disebut, hilang={hilang}")

# ── 3. Setiap berkas yang ditautkan README benar-benar ada
tautan = re.findall(r"\]\((?!http)([^)#]+)\)", README)
rusak = [t for t in tautan if not (ROOT / t).exists()]
check("Semua tautan berkas di README valid", not rusak, f"{len(tautan)} tautan, rusak={rusak}")

# ── 4. Angka keterlacakan sesuai output alat
trace = jalankan("python3 tools/traceability.py")
mt = re.search(r"Ringkasan: (\d+) siap · (\d+) sengaja ditunda", trace)
if mt:
    siap, tunda = int(mt.group(1)), int(mt.group(2))
    mr = re.search(r"(\d+) siap, (\d+) ditunda", README)
    check("Angka keterlacakan di README sesuai alat",
          mr and int(mr.group(1)) == siap and int(mr.group(2)) == tunda,
          f"alat={siap} siap/{tunda} ditunda, README={mr.group(0) if mr else 'tidak disebut'}")
    mp = re.search(r"Endpoint kontrak berstatus planned: (\d+)", trace)
    mrp = re.search(r"belum ada kodenya \((\d+) endpoint\)", README)
    check("Jumlah endpoint 'belum berkode' sesuai alat",
          mp and mrp and int(mp.group(1)) == int(mrp.group(1)),
          f"alat={mp.group(1) if mp else '?'}, README={mrp.group(1) if mrp else 'tidak disebut'}")

# ── 5. Angka validator dokumen
docs = jalankan("python3 tools/validate_docs.py | tail -1")
md = re.search(r"(\d+)/(\d+) check lulus", docs)
mrd = re.search(r"validate_docs\.py`? \| (\d+)/(\d+) lulus", README)
check("Angka check dokumen di README sesuai alat",
      md and mrd and md.group(1) == mrd.group(1) and md.group(2) == mrd.group(2),
      f"alat={md.group(0) if md else '?'}, README={mrd.group(0) if mrd else 'tidak disebut'}")

# ── 6. Fitur yang diklaim "belum ada" memang tidak ada di kode
SRC = "\n".join(p.read_text(encoding="utf-8")
                for p in list((ROOT / "apps").rglob("src/**/*.ts")))
if "Google OAuth" in README:
    check("Klaim Google OAuth belum ada memang benar",
          "oauth" not in SRC.lower() or "google" not in SRC.lower(),
          "tidak ada implementasi OAuth di kode")

# ── laporan
lebar = max(len(n) for n, _, _ in hasil)
gagal = [h for h in hasil if not h[1]]
for nama, ok, detail in hasil:
    print(f"[{'OK  ' if ok else 'BASI'}] {nama.ljust(lebar)}  {detail}")
print(f"\n{len(hasil) - len(gagal)}/{len(hasil)} klaim README terverifikasi")
print("README akurat." if not gagal else "README MEMUAT KLAIM YANG TIDAK SESUAI KENYATAAN")
sys.exit(1 if gagal else 0)
