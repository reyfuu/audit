# FRD — Functional Requirements Document
**Produk:** SiapAI · **Versi:** 1.0 · **Tanggal:** 2026-09-12

Konvensi: **FR-xx** requirement fungsional, **BR-xx** business rule. Setiap FR punya kriteria penerimaan (AC) yang dapat diuji.

---

## 1. Aktor & Peran
| Peran | Hak |
|---|---|
| `guest` | Quick Check, lihat skor ringkas |
| `member` | Isi assessment, lihat laporan org |
| `admin` (org) | + undang user, kelola org, beli paket |
| `owner` (org) | + transfer kepemilikan, hapus org |
| `partner` | + white-label branding |
| `sysadmin` | Kelola bank pertanyaan, rubrik, benchmark |

Matriks izin (RBAC) diberlakukan di layer API, bukan hanya UI.

## 2. Modul Autentikasi
**FR-01 Registrasi email + OTP.**
- AC1: Email valid → OTP 6 digit terkirim, berlaku 10 menit, maks 5 percobaan.
- AC2: OTP salah 5x → akun terkunci 15 menit.
- AC3: Setelah verifikasi, dibuat `User` dan `Organization` default.

**FR-02 Login Google OAuth2.** AC: Email sama dengan akun existing → akun ditautkan, bukan duplikat.

**FR-03 Sesi.** AC: Access token JWT 15 menit, refresh token 30 hari rotatif; logout mencabut refresh token.

**FR-04 Undang anggota.** AC: admin mengirim undangan; tautan berlaku 7 hari; peran ditetapkan saat undangan.

## 3. Modul Organisasi
**FR-05 Profil organisasi** — field wajib: `name`, `industry`, `employee_band`, `revenue_band`, `country`, `province`.
- AC: `industry` harus dari enum terkendali (lihat FRD §9); perubahan industri setelah assessment selesai tidak mengubah skor historis.

**FR-06 Multi-organisasi per user.** AC: user dapat menjadi anggota >1 org; konteks org aktif ditentukan header `X-Org-Id`.

## 4. Modul Assessment (inti)
**FR-07 Mulai assessment.**
- Input: `type` = `QUICK` | `FULL`, `organization_id`.
- AC1: Sistem menyematkan `questionnaire_version` dan `rubric_version` yang aktif saat itu ke assessment (immutable).
- AC2: Hanya boleh ada 1 assessment berstatus `IN_PROGRESS` per org per type; memulai yang baru mengembalikan 409 dengan id assessment berjalan.

**FR-08 Pengambilan pertanyaan bertahap.**
- AC1: `GET /assessments/{id}/next` mengembalikan satu seksi berisi pertanyaan yang **lolos aturan visibilitas** berdasarkan jawaban terkini.
- AC2: Respons menyertakan `progress {answered, total_visible, percent}`.

**FR-09 Simpan jawaban (autosave).**
- AC1: `PATCH /assessments/{id}/answers` menerima batch jawaban, idempoten per `question_code` (upsert).
- AC2: Autosave client tiap 5 detik atau saat blur; kegagalan jaringan disimpan di local storage dan di-retry.
- AC3: Jawaban untuk pertanyaan yang tidak visible ditolak `422 QUESTION_NOT_VISIBLE`.
- AC4: Tipe nilai divalidasi terhadap definisi pertanyaan; mismatch → `422 INVALID_ANSWER_TYPE`.

**FR-10 Lanjutkan assessment.** AC: `GET /assessments/{id}` mengembalikan semua jawaban tersimpan; resume lintas perangkat.

**FR-11 Review sebelum submit.** AC: Menampilkan daftar pertanyaan belum terjawab dengan tautan lompat.

**FR-12 Submit.**
- AC1: Ditolak `422 INCOMPLETE` bila ada pertanyaan wajib & visible yang kosong, dengan daftar `question_code` yang kurang.
- AC2: Sukses → status `SUBMITTED`, skoring dijalankan sinkron (< 2 detik), status menjadi `SCORED`, `submitted_at` terisi.
- AC3: Assessment `SCORED` bersifat **read-only**; perubahan jawaban memerlukan assessment baru.

**FR-13 Batal / hapus draft.** AC: Hanya status `IN_PROGRESS` yang dapat dihapus; soft delete 30 hari.

## 5. Modul Skoring
**BR-01 Nilai opsi.** Tiap opsi pilihan memiliki `score` 0–100 yang didefinisikan di rubrik.
**BR-02 Skor dimensi.**
```
dimension_score = Σ(answer_score_i × question_weight_i) / Σ(question_weight_i)
```
Pertanyaan tidak visible dikeluarkan dari pembilang dan penyebut (tidak dihukum).
**BR-03 Skor total.** `total = Σ(dimension_score_d × dimension_weight_d)`, Σ bobot dimensi = 1.0. Dibulatkan 1 desimal, half-up.
**BR-04 Level maturitas.** `1: <20 · 2: 20–39.9 · 3: 40–59.9 · 4: 60–79.9 · 5: ≥80`.
**BR-05 Verdict.** `READY ≥70 · CONDITIONALLY_READY 50–69.9 · NOT_READY <50`.
**BR-06 Hard gate data.** Jika `DAT < 40` maka verdict dipaksa `NOT_READY` dan ditampilkan alasan `DATA_FOUNDATION_GATE`.
**BR-07 Hard gate tata kelola.** Jika `GOV < 30` maka verdict maksimal `CONDITIONALLY_READY`.
**BR-08 Determinisme.** Skoring adalah fungsi murni dari `(answers, rubric_version)`; disimpan sebagai snapshot `score_breakdown` JSON.
**BR-09 Confidence.** `confidence = 0.6 + 0.4 × rasio_pertanyaan_dengan_bukti`, ditampilkan sebagai Low/Medium/High.

**FR-14 Rekomendasi.**
- Setiap pertanyaan dengan skor < 60 memicu satu atau lebih `Recommendation` dari katalog rule.
- Rekomendasi memiliki `impact` (1–5), `effort` (1–5), `horizon` (`0_3M`|`3_6M`|`6_12M`), `owner_role`, `estimated_cost_band`.
- AC1: Diurutkan berdasar `priority_score = impact / effort`, ambil top 10, minimal 3.
- AC2: Deduplikasi berdasarkan `recommendation_code`.

**FR-15 Benchmark.**
- AC1: Percentile dihitung terhadap assessment `SCORED` dalam 12 bulan terakhir pada `industry` + `employee_band` yang sama.
- AC2: Bila sampel < 30, fallback ke level `industry` saja; bila masih < 30, tampilkan `benchmark_available: false`, jangan tampilkan angka palsu.

## 6. Modul Laporan
**FR-16 Halaman hasil.** Menampilkan: verdict, skor total, radar 7 dimensi, tabel skor & level, benchmark, top rekomendasi, roadmap 3 horizon, confidence.
**FR-17 Ekspor PDF.** AC: Dihasilkan server-side, konten identik halaman hasil, < 10 detik, disimpan ke object storage, tautan unduh berlaku 24 jam.
**FR-18 Share link.** AC: Token acak 32 byte, read-only, dapat dicabut, opsi kedaluwarsa 7/30/90 hari, opsi sembunyikan nama perusahaan.
**FR-19 Riwayat & tren.** AC: Grafik garis skor total & per dimensi antar assessment, minimal 2 assessment untuk ditampilkan.

## 7. Modul Admin (sysadmin)
**FR-20 CMS bank pertanyaan.** CRUD pertanyaan, opsi, bobot, aturan visibilitas; perubahan membuat `questionnaire_version` baru berstatus `DRAFT` → `PUBLISHED`.
**FR-21 Versi rubrik.** AC: Versi `PUBLISHED` tidak dapat diubah; hanya bisa dibuat versi baru.
**FR-22 Preview.** AC: sysadmin dapat menjalankan assessment uji pada versi `DRAFT` tanpa memengaruhi benchmark (`is_test = true`).

## 8. Modul Pembayaran
**FR-23 Checkout Pro.** AC: Setelah pembayaran `settlement` dari webhook, `entitlement` org diaktifkan; webhook idempoten berdasar `order_id`; verifikasi signature wajib.
**FR-24 Paywall.** AC: Assessment `FULL` dapat diisi tanpa bayar, tetapi halaman hasil detail & PDF terkunci sampai entitlement aktif.

## 9. Enum Terkendali
`industry`: `manufacturing, retail_ecommerce, fnb, logistics, financial_services, healthcare, education, professional_services, construction_property, agriculture, media_creative, technology, government_public, other`
`employee_band`: `1_9, 10_49, 50_99, 100_499, 500_999, 1000_plus`
`revenue_band_idr`: `under_2_5b, 2_5b_15b, 15b_50b, 50b_250b, 250b_plus, undisclosed`

## 10. Aturan Validasi Form
| Field | Aturan |
|---|---|
| `single_choice` | value ∈ option ids |
| `multi_choice` | subset option ids, hormati `min_select`/`max_select` |
| `scale_1_5` | integer 1..5 |
| `boolean` | true/false |
| `number` | numeric, hormati `min`/`max` |
| `text` | ≤ 1000 karakter, tidak diskor, disanitasi |

## 11. Penanganan Error (kontrak)
Semua error memakai amplop seragam:
```json
{ "error": { "code": "INCOMPLETE", "message": "...", "details": { "missing": ["DAT-03"] }, "trace_id": "..." } }
```
Kode: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INCOMPLETE, INVALID_ANSWER_TYPE, QUESTION_NOT_VISIBLE, RATE_LIMITED, PAYMENT_REQUIRED, INTERNAL`.

## 12. Matriks Telusur
| FR | Sumber BRD/PRD | Uji |
|---|---|---|
| FR-07..FR-13 | G1, F04, PA2 | E2E: isi, tutup, lanjut di device lain |
| FR-12, BR-01..BR-08 | BA2, PA4 | Unit: property test determinisme |
| FR-14 | BA3 | Unit: minimal 3 rekomendasi untuk semua profil |
| FR-16..FR-18 | G2, PA3 | Snapshot PDF vs HTML |
| FR-15 | F10 | Unit: fallback saat sampel < 30 |
