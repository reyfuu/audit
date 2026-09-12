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

# ── R10 Quick Check = 15 pertanyaan (PRD F03) dan semua kodenya ada
qc = re.search(r"## Quick Check.*?\n`(.+?)`", DOCS["QB"], re.S).group(1).split(", ")
known = set(codes) | {"ORG-01","ORG-02","ORG-03","ORG-04","ORG-05","ORG-06"}
check("R10a","Quick Check tepat 15 pertanyaan (PRD F03)", len(qc)==15, f"jumlah={len(qc)}")
check("R10b","Semua kode Quick Check terdefinisi", set(qc) <= known, f"tidak dikenal={set(qc)-known}")

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
    "/assessments": "FR-07 mulai assessment",
    "/assessments/{assessmentId}/next": "FR-08 ambil pertanyaan",
    "/assessments/{assessmentId}/answers": "FR-09 autosave",
    "/assessments/{assessmentId}/submit": "FR-12 submit",
    "/assessments/{assessmentId}/result": "FR-16 halaman hasil",
    "/assessments/{assessmentId}/recommendations": "FR-14 rekomendasi",
    "/assessments/{assessmentId}/report/pdf": "FR-17 ekspor PDF",
    "/assessments/{assessmentId}/share-links": "FR-18 share link",
    "/organizations/{orgId}/trend": "FR-19 riwayat & tren",
    "/benchmark": "FR-15 benchmark",
    "/billing/checkout": "FR-23 pembayaran",
    "/public/quick-check": "PRD F03 quick check",
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

ok, obs = has_response("/assessments/{assessmentId}/submit", "post", "422")
check("R18a","Submit mengembalikan 422 INCOMPLETE (FR-12 AC1)", ok, obs)
ok, obs = has_response("/assessments", "post", "409")
check("R18b","Mulai assessment mengembalikan 409 (FR-07 AC2)", ok, obs)
ok, obs = has_response("/assessments/{assessmentId}/result", "get", "402")
check("R18c","Result mengembalikan 402 saat paywall (FR-24)", ok, obs)

# ── R19 endpoint publik tidak mewajibkan auth; endpoint privat mewajibkan
# /auth/logout sengaja dikecualikan: mencabut refresh token milik pemanggil,
# sehingga wajib terautentikasi meski berada di bawah prefix /auth.
AUTHENTICATED_AUTH_PATHS = {"/auth/logout", "/me"}
pub_ok, priv_ok = [], []
for path, item in SPEC["paths"].items():
    for method, op in item.items():
        if method not in ("get","post","patch","put","delete"): continue
        is_public = (path.startswith("/public") or path == "/billing/webhook"
                     or (path.startswith("/auth") and path not in AUTHENTICATED_AUTH_PATHS))
        has_override = op.get("security") == []
        if is_public and not has_override: pub_ok.append(f"{method} {path}")
        if not is_public and has_override: priv_ok.append(f"{method} {path}")
check("R19a","Endpoint publik memakai security: []", not pub_ok, f"pelanggaran={pub_ok}")
check("R19b","Endpoint privat tidak melewati auth", not priv_ok, f"pelanggaran={priv_ok}")
check("R19c","/auth/logout & /me tetap mewajibkan auth",
      all(SPEC["paths"][p][m].get("security") != []
          for p in AUTHENTICATED_AUTH_PATHS for m in SPEC["paths"][p]
          if m in ("get","post")),
      "logout dan /me terlindungi")

# ── R20 endpoint ber-scope org mewajibkan header X-Org-Id (TRD tenant isolation)
def params_of(path, op):
    return [p.get("$ref","") for p in (SPEC["paths"][path].get("parameters",[]) + op.get("parameters",[]))]
org_scoped = [p for p in SPEC["paths"] if p.startswith("/assessments")]
miss = []
for p in org_scoped:
    for m, op in SPEC["paths"][p].items():
        if m in ("get","post","patch","delete") and "OrgIdHeader" not in " ".join(params_of(p, op)):
            miss.append(f"{m} {p}")
check("R20","Endpoint /assessments mewajibkan X-Org-Id", not miss, f"kurang={miss}")

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

# ── laporan
w1 = max(len(r[0]) for r in results)
fails = [r for r in results if not r[2]]
for req, desc, ok, obs in results:
    print(f"[{'PASS' if ok else 'FAIL'}] {req.ljust(w1)}  {desc}\n            └─ {obs}")
print(f"\n{len(results)-len(fails)}/{len(results)} check lulus")
sys.exit(1 if fails else 0)
