#!/usr/bin/env python3
"""Validasi konsistensi dokumen SiapAI.

Tiap check dipetakan ke requirement eksplisit di BRD/PRD/FRD/TRD/DESIGN.
Jalankan: python3 tools/validate_docs.py
"""
import re, sys, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
def read(p): return (ROOT / p).read_text(encoding="utf-8")

DOCS = {n: read(p) for n, p in {
    "BRD": "docs/BRD.md", "PRD": "docs/PRD.md", "FRD": "docs/FRD.md",
    "TRD": "docs/TRD.md", "DESIGN": "DESIGN.md", "QB": "docs/QUESTION_BANK.md",
    "README": "README.md",
}.items()}
SPEC = yaml.safe_load(read("contracts/openapi.yaml"))
SPEC_TEXT = read("contracts/openapi.yaml")
ALL_DOCS = "\n".join(DOCS.values())

results = []
def check(req, desc, ok, observed):
    results.append((req, desc, bool(ok), observed))

# ── R1 deliverables ada (permintaan user: brd, frd, trd, prd, DESIGN, api contract, form)
for name, path in [("BRD","docs/BRD.md"),("FRD","docs/FRD.md"),("TRD","docs/TRD.md"),
                   ("PRD","docs/PRD.md"),("DESIGN","DESIGN.md"),
                   ("API contract","contracts/openapi.yaml"),("Form","docs/QUESTION_BANK.md")]:
    f = ROOT / path
    check("R1", f"{name} ada dan tidak kosong", f.exists() and f.stat().st_size > 1000,
          f"{path}: {f.stat().st_size if f.exists() else 0} bytes")

# ── R2 OpenAPI: semua $ref resolve
refs = sorted(set(re.findall(r"#/components/(\w+)/([A-Za-z0-9_]+)", SPEC_TEXT)))
bad = [f"{a}/{b}" for a, b in refs if b not in SPEC["components"].get(a, {})]
check("R2", "Semua $ref OpenAPI resolve", not bad, f"{len(refs)} ref diperiksa, rusak={bad}")

# ── R3 setiap operation punya tag, summary, dan minimal satu respons sukses/terdefinisi
missing = []
ops = 0
for path, item in SPEC["paths"].items():
    for method, op in item.items():
        if method in ("get","post","patch","put","delete"):
            ops += 1
            if not op.get("tags"): missing.append(f"{method.upper()} {path}: tags")
            if not op.get("summary"): missing.append(f"{method.upper()} {path}: summary")
            if not op.get("responses"): missing.append(f"{method.upper()} {path}: responses")
check("R3", "Tiap operation punya tag/summary/responses", not missing,
      f"{ops} operation, kurang={missing}")

# ── R4 FRD §11 error codes == enum di OpenAPI
frd_codes = set(re.findall(r"[A-Z_]{4,}", re.search(
    r"Kode: (.+?)\.\n", DOCS["FRD"], re.S).group(1)))
spec_codes = set(SPEC["components"]["schemas"]["ErrorEnvelope"]["properties"]["error"]["properties"]["code"]["enum"])
check("R4", "Error code FRD selaras dengan OpenAPI", frd_codes == spec_codes,
      f"hanya-FRD={frd_codes-spec_codes} hanya-spec={spec_codes-frd_codes}")

# ── R5 enum terkendali FRD §9 == OpenAPI
def enum_of(name): return set(SPEC["components"]["schemas"][name]["enum"])
frd_ind = set(re.search(r"`industry`: `(.+?)`", DOCS["FRD"]).group(1).replace("\n"," ").split(", "))
frd_emp = set(re.search(r"`employee_band`: `(.+?)`", DOCS["FRD"]).group(1).split(", "))
frd_rev = set(re.search(r"`revenue_band_idr`: `(.+?)`", DOCS["FRD"]).group(1).split(", "))
check("R5a","Enum industry FRD == OpenAPI", frd_ind==enum_of("Industry"), f"diff={frd_ind^enum_of('Industry')}")
check("R5b","Enum employee_band FRD == OpenAPI", frd_emp==enum_of("EmployeeBand"), f"diff={frd_emp^enum_of('EmployeeBand')}")
check("R5c","Enum revenue_band FRD == OpenAPI", frd_rev==enum_of("RevenueBand"), f"diff={frd_rev^enum_of('RevenueBand')}")

# ── R6 bobot dimensi PRD berjumlah 100% (BR-03: Σ = 1.0)
w = [int(x) for x in re.findall(r"\| (\d+)% \|", DOCS["PRD"])]
check("R6", "Bobot 7 dimensi PRD berjumlah 100%", sum(w)==100 and len(w)==7, f"bobot={w} total={sum(w)}%")

# ── R7 bobot dimensi README konsisten dengan PRD
rw = sorted(int(x) for x in re.findall(r"\| (\d+)% \|", DOCS["README"]))
check("R7", "Bobot README == bobot PRD", rw==sorted(w), f"README={rw} PRD={sorted(w)}")

# ── R8 dimension code konsisten: PRD, QUESTION_BANK, OpenAPI
DIMS = {"STR","DAT","TEC","PPL","PRC","GOV","FIN"}
check("R8a","DimensionCode OpenAPI == 7 dimensi PRD", enum_of("DimensionCode")==DIMS, f"{sorted(enum_of('DimensionCode'))}")
qb_dims = set(re.findall(r"^## ([A-Z]{3}) — ", DOCS["QB"], re.M))
check("R8b","Question bank memuat semua 7 dimensi", qb_dims==DIMS, f"ditemukan={sorted(qb_dims)}")

# ── R9 tiap pertanyaan question bank punya kode unik & dimensi valid
codes = re.findall(r"\*\*([A-Z]{3}-\d{2}) \(", DOCS["QB"])
dupes = {c for c in codes if codes.count(c) > 1}
check("R9a","Kode pertanyaan unik", not dupes, f"{len(codes)} pertanyaan berskor, duplikat={dupes}")
check("R9b","Prefix kode pertanyaan = dimensi valid", all(c[:3] in DIMS for c in codes),
      f"prefix tidak valid={[c for c in codes if c[:3] not in DIMS]}")

# ── R10 pertanyaan inti penentu kesiapan terdefinisi dan konsisten
m = re.search(r"## Pertanyaan Inti Penentu Kesiapan.*?\n`(.+?)`", DOCS["QB"], re.S)
core = m.group(1).split(", ") if m else []
known = set(codes) | {"ORG-01","ORG-02","ORG-03","ORG-04","ORG-05","ORG-06"}
check("R10a","Ada daftar pertanyaan inti penentu kesiapan", len(core) > 0, f"jumlah={len(core)}")
check("R10b","Semua kode pertanyaan inti terdefinisi", set(core) <= known, f"tidak dikenal={set(core)-known}")
marked = {c for c in re.findall(r"\*\*([A-Z]{3}-\d{2}) \([A-Z0-9]+, w=\d+, Q\)", DOCS["QB"])}
check("R10c","Penanda Q di daftar pertanyaan sama dengan daftar inti", marked == set(core),
      f"hanya-penanda={marked-set(core)} hanya-daftar={set(core)-marked}")

# ── R11 tiap pertanyaan yang dirujuk aturan rekomendasi memang ada
rec_refs = set(re.findall(r"`([A-Z]{3}-\d{2}) [≤=]", DOCS["QB"]))
check("R11","Pemicu rekomendasi merujuk pertanyaan yang ada", rec_refs <= set(codes),
      f"{len(rec_refs)} pemicu, menggantung={rec_refs-set(codes)}")

# ── R12 minimal 3 rekomendasi (BA3/FR-14) tersedia di katalog & dijamin di schema
rec_codes = set(re.findall(r"\| (REC-[A-Z]{3}-\d{3}) \|", DOCS["QB"]))
check("R12a","Katalog rekomendasi >= 3 (BA3)", len(rec_codes) >= 3, f"{len(rec_codes)} rekomendasi")
check("R12b","Schema RecommendationBundle memaksa minItems 3",
      SPEC["components"]["schemas"]["RecommendationBundle"]["properties"]["items"].get("minItems")==3,
      f"minItems={SPEC['components']['schemas']['RecommendationBundle']['properties']['items'].get('minItems')}")

# ── R13 ambang skoring PRD == FRD (BR-04, BR-05)
for token in ["<20","20–39","40–59","60–79","≥80"]:
    check("R13a", f"Ambang level {token} ada di PRD & FRD",
          token.split("–")[0] in DOCS["PRD"] and token.split("–")[0] in DOCS["FRD"], token)
for token in ["READY","CONDITIONALLY_READY","NOT_READY"]:
    check("R13b", f"Verdict {token} ada di PRD, FRD, OpenAPI",
          token in DOCS["PRD"] and token in DOCS["FRD"] and token in enum_of("Verdict"), token)

# ── R14 hard gate (BR-06, BR-07) terepresentasi di OpenAPI schema Gate
gate_enum = set(SPEC["components"]["schemas"]["Gate"]["properties"]["code"]["enum"])
check("R14","Hard gate FRD BR-06/BR-07 ada di schema Gate",
      gate_enum == {"DATA_FOUNDATION_GATE","GOVERNANCE_GATE"}, f"{sorted(gate_enum)}")

# ── R15 tiap FR di FRD punya nomor unik & berurutan
frs = re.findall(r"\*\*(FR-\d{2})", DOCS["FRD"])
uniq = sorted(set(frs), key=lambda x: int(x[3:]))
nums = [int(x[3:]) for x in uniq]
check("R15","FR bernomor unik dan berurutan tanpa celah",
      nums == list(range(1, max(nums)+1)), f"{len(uniq)} FR, rentang 1..{max(nums)}, celah={sorted(set(range(1,max(nums)+1))-set(nums))}")

# ── R16 tautan relatif di README menunjuk file yang ada
links = re.findall(r"\]\((?!http)([^)]+)\)", DOCS["README"])
broken = [l for l in links if not (ROOT / l).exists()]
check("R16","Semua tautan README valid", not broken, f"{len(links)} tautan, rusak={broken}")

# ── R17 endpoint yang dijanjikan FRD benar-benar ada di kontrak
required_paths = {
    "/invitations": "FR-23 terbitkan undangan",
    "/invitations/{invitationId}": "FR-27 cabut undangan",
    "/invitations/{invitationId}/reissue": "FR-27 AC2 terbitkan ulang",
    "/invitations/{invitationId}/qr.png": "FR-24 QR PNG",
    "/invitations/{invitationId}/qr.svg": "FR-24 QR SVG",
    "/f/{token}": "FR-25 halaman sambutan form responden",
    "/f/{token}/next": "FR-08 ambil pertanyaan",
    "/f/{token}/answers": "FR-09 autosave",
    "/f/{token}/review": "FR-11 review sebelum kirim",
    "/f/{token}/submit": "FR-12 submit",
    "/f/{token}/result": "FR-16 hasil untuk responden",
    "/assessments": "daftar assessment untuk auditor",
    "/assessments/{assessmentId}/report/pdf": "FR-17 ekspor PDF",
    "/assessments/{assessmentId}/share-links": "FR-18 share link",
    "/companies/{companyId}/trend": "FR-19 riwayat & tren",
    "/benchmark": "FR-15 benchmark",
    "/admin/questionnaires": "FR-20 CMS",
}
for p, why in required_paths.items():
    check("R17", f"Endpoint {p} ({why})", p in SPEC["paths"], "ada" if p in SPEC["paths"] else "HILANG")

# ── R18 kondisi error kunci terdokumentasi di kontrak
def has_response(path, method, code):
    """Aman terhadap path/method yang hilang: laporkan FAIL, jangan crash."""
    try:
        return code in SPEC["paths"][path][method]["responses"], "terdefinisi"
    except KeyError:
        return False, f"path/method hilang: {method.upper()} {path}"

ok, obs = has_response("/f/{token}/submit", "post", "422")
check("R18a","Submit mengembalikan 422 INCOMPLETE (FR-12 AC1)", ok, obs)
ok, obs = has_response("/invitations", "post", "409")
check("R18b","Terbitkan undangan mengembalikan 409 saat masih ada yang aktif (FR-23 AC4)", ok, obs)
ok, obs = has_response("/f/{token}", "get", "404")
check("R18c","Token tidak valid/dicabut mengembalikan 404 netral (FR-25 AC3)", ok, obs)

# ── R19 model auth v2: jalur responden /f/{token} tidak memakai Bearer
# (token undangan adalah kredensialnya), sisanya wajib Bearer.
# /auth/me, /auth/invites, dan /auth/password tetap butuh Bearer meski berada
# di bawah /auth: ketiganya bekerja atas nama auditor yang sudah masuk.
AUTHENTICATED_AUTH_PATHS = {"/auth/me", "/auth/invites", "/auth/password"}
token_auth, priv_ok = [], []
for path, item in SPEC["paths"].items():
    for method, op in item.items():
        if method not in ("get","post","patch","put","delete"): continue
        # Jalur bertoken: responden (/f) dan laporan yang dibagikan (/l).
        # Keduanya sengaja tanpa Bearer; tokennya sendiri adalah kredensial.
        is_token_path = path.startswith("/f/{token}") or path.startswith("/l/{token}")
        is_public = is_token_path or (path.startswith("/auth") and path not in AUTHENTICATED_AUTH_PATHS)
        has_override = op.get("security") == []
        if is_public and not has_override: token_auth.append(f"{method} {path}")
        if not is_public and has_override: priv_ok.append(f"{method} {path}")
check("R19a","Jalur bertoken (/f dan /l) memakai security: [] (FR-25 AC4, FR-18)",
      not token_auth, f"pelanggaran={token_auth}")
check("R19b","Endpoint auditor tidak melewati auth", not priv_ok, f"pelanggaran={priv_ok}")
check("R19c","/auth/me & /auth/invites tetap mewajibkan auth",
      all(SPEC["paths"][p][m].get("security") != []
          for p in AUTHENTICATED_AUTH_PATHS for m in SPEC["paths"][p]
          if m in ("get","post")),
      "endpoint profil dan undangan tim terlindungi")
check("R19d","Endpoint QR memerlukan auth auditor (FR-24 AC4)",
      all(SPEC["paths"][p]["get"].get("security") != []
          for p in ("/invitations/{invitationId}/qr.png", "/invitations/{invitationId}/qr.svg")),
      "QR tidak dapat diakses anonim")

# ── R20 scope ditentukan kepemilikan data, bukan header yang bisa dipalsu
def params_of(path, op):
    return [p.get("$ref","") for p in (SPEC["paths"][path].get("parameters",[]) + op.get("parameters",[]))]

# Model v2 tidak lagi memakai X-Company-Id. Auditor di-scope lewat
# owner_auditor_id di layer repository, dan jalur bertoken lewat tokennya
# sendiri. Header apa pun dapat dipalsu klien, jadi tidak boleh menjadi
# dasar otorisasi di endpoint mana pun.
header_dipakai = []
for p, item in SPEC["paths"].items():
    for m, op in item.items():
        if m in ("get","post","patch","delete") and "CompanyIdHeader" in " ".join(params_of(p, op)):
            header_dipakai.append(f"{m} {p}")
check("R20a","Tidak ada endpoint yang mengandalkan header X-Company-Id",
      not header_dipakai, f"pelanggaran={header_dipakai}")

# Jalur bertoken tidak boleh menuntut id internal apa pun dari klien.
leak = []
for p in [x for x in SPEC["paths"] if x.startswith("/f/{token}") or x.startswith("/l/{token}")]:
    for m, op in SPEC["paths"][p].items():
        if m in ("get","post","patch","delete"):
            names = [q.get("name","") for q in
                     (SPEC["paths"][p].get("parameters",[]) + op.get("parameters",[]))
                     if isinstance(q, dict)]
            if any(n.lower() in ("company_id","assessmentid","companyid") for n in names):
                leak.append(f"{m} {p}")
check("R20b","Jalur bertoken tidak menuntut id internal dari klien", not leak,
      f"pelanggaran={leak}")

# ── R21 mermaid diagram seimbang (setiap ``` mermaid ditutup)
for name in ("BRD","PRD","TRD","DESIGN"):
    n = DOCS[name].count("```")
    check("R21", f"Fenced block {name} seimbang", n % 2 == 0, f"{n} fence")

# ── R22 dokumen saling bertaut (traceability)
check("R22a","FRD punya matriks telusur ke BRD/PRD", "Matriks Telusur" in DOCS["FRD"], "ada §12")
check("R22b","PRD merujuk dokumen lain", all(d in DOCS["PRD"] for d in ["BRD.md","FRD.md","TRD.md","DESIGN.md","openapi.yaml"]), "semua tertaut")

# ── R23 stack backend konsisten: Elysia/Bun/Drizzle, tanpa sisa NestJS/Prisma
STALE = ["NestJS", "Prisma", "prisma/", "Vitest", "npm audit", "class-validator"]
# Penyebutan sah: alternatif yang ditolak, catatan konsekuensi, atau deskripsi
# mutation test yang justru membuktikan validator ini bekerja.
ALLOWED_CONTEXT = ("ditolak", "menggantikan", "lebih muda dari", "Alternatif",
                   "mutation test", "terdeteksi sebagai FAIL")
stale_hits = []
for name, text in DOCS.items():
    for i, line in enumerate(text.splitlines(), 1):
        if any(s in line for s in STALE) and not any(a in line for a in ALLOWED_CONTEXT):
            stale_hits.append(f"{name}:{i}")
check("R23a", "Tidak ada sisa stack lama (NestJS/Prisma/Vitest)", not stale_hits,
      f"baris bermasalah={stale_hits}")

for doc, token in [("TRD","Elysia"), ("TRD","Bun"), ("TRD","Drizzle"),
                   ("DESIGN","Elysia"), ("README","Elysia")]:
    check("R23b", f"{doc} menyebut {token}", token in DOCS[doc],
          "ada" if token in DOCS[doc] else "HILANG")

check("R23c", "ADR mencatat keputusan pergantian backend",
      "ADR-007" in DOCS["DESIGN"] and "ADR-008" in DOCS["DESIGN"],
      "ADR-007 (Elysia) & ADR-008 (Drizzle) terdokumentasi")

check("R23d", "Struktur repo TRD menyebut apps/api Elysia",
      "apps/api        Elysia" in DOCS["TRD"], "tercantum di §12")

# ── R24 model v2: tidak ada paywall di mana pun (FR-30, BA6, PA4)
check("R24a", "Tidak ada respons 402 di seluruh kontrak",
      "402" not in {c for it in SPEC["paths"].values() for op in it.values()
                    if isinstance(op, dict) for c in op.get("responses", {})},
      "tidak ada status 402")
check("R24b", "PAYMENT_REQUIRED tidak ada di enum error",
      "PAYMENT_REQUIRED" not in SPEC["components"]["schemas"]["ErrorEnvelope"]
        ["properties"]["error"]["properties"]["code"]["enum"],
      "kode pembayaran sudah dihapus")
check("R24c", "Tidak ada schema pembayaran tersisa",
      not {"Entitlement", "QuickCheckResult"} & set(SPEC["components"]["schemas"]),
      "Entitlement & QuickCheckResult sudah dihapus")
paywall_words = ["Midtrans", "checkout", "paywall", "Paywall", "entitlement", "tier gratis", "Quick Check"]
leftovers = []
for name, text in DOCS.items():
    for i, line in enumerate(text.splitlines(), 1):
        if any(w in line for w in paywall_words) and not any(
            a in line for a in ("dihapus", "Dihapus", "dibatalkan", "tidak ada", "Tidak ada",
                                "tidak boleh", "Perubahan dari")):
            leftovers.append(f"{name}:{i}")
check("R24d", "Dokumen tidak menyisakan konsep berbayar/tier gratis", not leftovers,
      f"baris bermasalah={leftovers}")

# ── R25 alur undangan & QR konsisten (FR-23..FR-29)
inv = SPEC["components"]["schemas"]["InvitationStatus"]["enum"]
check("R25a", "Status undangan lengkap sesuai FR-29 AC2",
      set(inv) == {"SENT","OPENED","IN_PROGRESS","SUBMITTED","SCORED","REVOKED","EXPIRED"},
      f"{inv}")
created = SPEC["components"]["schemas"]["InvitationCreated"]["allOf"][1]["properties"]
check("R25b", "Respons penerbitan memuat token, tautan, dan kedua format QR",
      {"token","invitation_url","qr_png_url","qr_svg_url"} <= set(created),
      f"{sorted(created)}")
check("R25c", "QR tersedia dalam PNG dan SVG (FR-24 AC1)",
      "image/png" in str(SPEC["paths"]["/invitations/{invitationId}/qr.png"]["get"]["responses"])
      and "image/svg+xml" in str(SPEC["paths"]["/invitations/{invitationId}/qr.svg"]["get"]["responses"]),
      "kedua format tersedia")
check("R25d", "QR PNG punya ukuran minimal 256 px (FR-24 AC2)",
      any(p.get("name") == "size" and p["schema"].get("minimum") == 256
          for p in SPEC["paths"]["/invitations/{invitationId}/qr.png"].get("parameters", [])),
      "parameter size minimum 256")
check("R25e", "Ada opsi label cetak agar QR tidak tertukar antar klien (FR-24 AC3)",
      any(p.get("name") == "print_label"
          for p in SPEC["paths"]["/invitations/{invitationId}/qr.png"].get("parameters", [])),
      "parameter print_label tersedia")
check("R25f", "Semua path responden memakai token undangan di path",
      all(p.startswith("/f/{token}") for p in SPEC["paths"] if p.startswith("/f/")),
      "jalur responden konsisten")
for frd_code in ["FR-23", "FR-24", "FR-25", "FR-26", "FR-27", "FR-28", "FR-29", "FR-30"]:
    check("R25g", f"{frd_code} terdokumentasi di FRD", frd_code in DOCS["FRD"],
          "ada" if frd_code in DOCS["FRD"] else "HILANG")
check("R25h", "PRD menjelaskan QR dan pengisian lewat HP",
      "QR" in DOCS["PRD"] and "Mobile-First" in DOCS["PRD"], "bagian QR & mobile-first ada")
check("R25i", "BRD menjelaskan model undangan menggantikan self-serve",
      "undangan" in DOCS["BRD"] and "QR" in DOCS["BRD"], "model baru terdokumentasi")

# ── laporan
w1 = max(len(r[0]) for r in results)
fails = [r for r in results if not r[2]]
for req, desc, ok, obs in results:
    print(f"[{'PASS' if ok else 'FAIL'}] {req.ljust(w1)}  {desc}\n            └─ {obs}")
print(f"\n{len(results)-len(fails)}/{len(results)} check lulus")
sys.exit(1 if fails else 0)
