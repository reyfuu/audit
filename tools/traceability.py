#!/usr/bin/env python3
"""Telusur FRD -> kontrak -> implementasi -> uji.

Tujuannya menemukan requirement yang terdokumentasi tetapi belum berwujud kode,
sehingga status proyek tidak dilaporkan lebih baik daripada kenyataannya.

Jalankan: python3 tools/traceability.py
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: (ROOT / p).read_text(encoding="utf-8")

FRD = read("docs/FRD.md")
SPEC = read("contracts/openapi.yaml")

SRC = "\n".join(
    p.read_text(encoding="utf-8")
    for p in list((ROOT / "apps").rglob("src/**/*.ts")) + list((ROOT / "packages").rglob("src/**/*.ts"))
)
TESTS = "\n".join(
    p.read_text(encoding="utf-8")
    for p in list((ROOT / "apps").rglob("test/**/*.ts")) + list((ROOT / "packages").rglob("test/**/*.ts"))
)

# Bukti implementasi per FR: penanda yang harus ada di kode sumber.
# None berarti sengaja belum diimplementasikan pada tahap ini.
IMPL_MARKERS = {
    "FR-01": ["request-otp", "verify-otp", "hashOtp"],
    "FR-02": None,  # Google OAuth: butuh kredensial eksternal, ditunda
    "FR-03": ["verifyAccessToken", "hashRefreshToken", "revokeSessionFamily"],
    "FR-04": ["/invites", "createAuditorInvite"],
    "FR-05": ["createCompany"],
    "FR-06": ["listCompanies", "owner_auditor_id"],
    "FR-07": ["createAssessment", "questionnaire_version"],
    "FR-08": ["/:token/next"],
    "FR-09": ["/:token/answers"],
    "FR-10": ["resume"],
    "FR-11": ["/:token/review", "missingRequired"],
    "FR-12": ["/:token/submit", "INCOMPLETE"],
    "FR-13": None,
    "FR-14": ["recommend("],
    "FR-15": ["benchmark_available"],
    "FR-16": ["/:token/result"],
    "FR-17": ["report/pdf", "renderPdf"],
    "FR-18": ["share-links", "findShareLinkByTokenHash", "anonymize"],
    "FR-19": None,
    "FR-20": None, "FR-21": None, "FR-22": None,
    "FR-23": ["/invitations", "token_hash", "sealToken"],
    "FR-24": ["qr.png", "qr.svg", "QRCode"],
    "FR-25": ["INVITATION_INVALID", "x-robots-tag"],
    "FR-26": ["findByTokenHash"],
    "FR-27": ["reissue", "REVOKED"],
    "FR-28": ["effectiveStatus", "EXPIRED"],
    "FR-29": ["listInvitations"],
    "FR-30": ["benchmark_available"],
}

# Penanda uji: FR dianggap teruji bila salah satu string ini muncul di berkas uji.
TEST_MARKERS = {fr: [fr] for fr in IMPL_MARKERS}
TEST_MARKERS["FR-05"] = ["createCompany", "/companies"]
TEST_MARKERS["FR-06"] = ["auditor lain"]
TEST_MARKERS["FR-07"] = ["FR-23"]  # assessment dibuat lewat penerbitan undangan
TEST_MARKERS["FR-10"] = ["FR-26"]
TEST_MARKERS["FR-14"] = ["rekomendasi"]
TEST_MARKERS["FR-15"] = ["benchmark"]
TEST_MARKERS["FR-01"] = ["FR-01"]
TEST_MARKERS["FR-03"] = ["FR-03"]
TEST_MARKERS["FR-04"] = ["FR-04"]
TEST_MARKERS["FR-17"] = ["FR-17"]
TEST_MARKERS["FR-18"] = ["FR-18"]

rows = []
for fr in sorted(IMPL_MARKERS, key=lambda x: int(x[3:])):
    documented = fr in FRD
    markers = IMPL_MARKERS[fr]
    if markers is None:
        status, detail = "BELUM", "sengaja ditunda"
        tested = False
    else:
        hits = [m for m in markers if m in SRC]
        implemented = len(hits) == len(markers)
        tested = any(m in TESTS for m in TEST_MARKERS[fr])
        if implemented and tested:
            status, detail = "SIAP", f"{len(hits)}/{len(markers)} penanda, teruji"
        elif implemented:
            status, detail = "TANPA UJI", f"{len(hits)}/{len(markers)} penanda, tidak ada uji"
        else:
            kurang = [m for m in markers if m not in SRC]
            status, detail = "SEBAGIAN", f"penanda hilang: {kurang}"
    rows.append((fr, documented, status, detail))

# Kontrak menandai tiap path dengan x-status. Di sini kita buktikan penandaan
# itu jujur: yang ditandai implemented harus benar-benar ada routenya di kode.
import yaml
SPEC_DOC = yaml.safe_load(SPEC)

def has_route(p: str) -> bool:
    """Mencari penanda route di kode sumber.

    Ini pemeriksaan statis. Bukti yang lebih kuat adalah uji otomatis yang
    memanggil endpointnya; lihat apps/api/test/endpoints.test.ts yang
    memverifikasi setiap path bertanda implemented benar-benar merespons.
    """
    tail = p.split("/")[-1].split("{")[0].strip("/")
    if p == "/f/{token}":
        return "'/:token'" in SRC
    if p.startswith("/f/"):
        return f"'/:token/{tail}'" in SRC
    if p == "/invitations":
        return "prefix: '/invitations'" in SRC
    if p.startswith("/invitations/"):
        seg = p.split("/")[-1]
        return (f"'/:id/{seg}'" in SRC) or (seg == "{invitationId}" and "'/:id'" in SRC)
    if p.startswith("/l/"):
        return "'/l/:token'" in SRC
    if p.startswith("/share-links/"):
        return "'/share-links/:id'" in SRC
    if p.startswith("/assessments/") and p.endswith("/share-links"):
        return "'/assessments/:id/share-links'" in SRC
    if p.startswith("/assessments/") and p.endswith("/report/pdf"):
        return "'/assessments/:id/report/pdf'" in SRC
    if p.startswith("/auth/"):
        seg = p.split("/")[-1]
        return f"'/{seg}'" in SRC
    if p == "/companies":
        return "prefix: '/companies'" in SRC
    if p.startswith("/companies/"):
        return "'/:id'" in SRC
    return False

berbohong, unimplemented = [], []
for path, item in SPEC_DOC["paths"].items():
    status = item.get("x-status")
    if status is None:
        berbohong.append(f"{path}: tanpa x-status")
    elif status == "implemented" and not has_route(path):
        berbohong.append(f"{path}: ditandai implemented tetapi routenya tidak ada")
    elif status == "planned":
        unimplemented.append(path)

print("┌─ TELUSUR FRD → IMPLEMENTASI → UJI " + "─" * 42)
undocumented = [fr for fr, doc, _, _ in rows if not doc]
for fr, doc, status, detail in rows:
    mark = {"SIAP": "✓", "BELUM": "·", "SEBAGIAN": "!", "TANPA UJI": "!"}[status]
    print(f"│ {mark} {fr}  {status.ljust(10)} {detail}")
print("└" + "─" * 76)

siap = sum(1 for _, _, s, _ in rows if s == "SIAP")
belum = sum(1 for _, _, s, _ in rows if s == "BELUM")
masalah = [r for r in rows if r[2] in ("SEBAGIAN", "TANPA UJI")]

print(f"\nRingkasan: {siap} siap · {belum} sengaja ditunda · {len(masalah)} bermasalah")
print(f"Endpoint kontrak berstatus planned: {len(unimplemented)}")
for p in unimplemented:
    print(f"  · {p}")
if berbohong:
    print("\nPENANDAAN KONTRAK TIDAK JUJUR:")
    for b in berbohong:
        print(f"  ! {b}")

if undocumented:
    print(f"\nFR tidak terdokumentasi di FRD: {undocumented}")

problems = bool(masalah) or bool(undocumented) or bool(berbohong)
print("\n" + ("ADA MASALAH KETERLACAKAN" if problems
      else "Status kontrak jujur: tidak ada yang diklaim melebihi kenyataan."))
sys.exit(1 if problems else 0)
