# FRD — Functional Requirements Document
**Produk:** SiapAI · **Versi:** 2.0 · **Tanggal:** 2026-09-12

> **Perubahan dari v1.0:** modul pembayaran/paywall dihapus. Ditambahkan modul
> Undangan & QR Code. Responden (owner) mengisi form tanpa akun, diautentikasi
> oleh token undangan.

Konvensi: **FR-xx** requirement fungsional, **BR-xx** business rule. Setiap FR punya kriteria penerimaan (AC) yang dapat diuji.

---

## 1. Aktor & Peran
| Peran | Autentikasi | Hak |
|---|---|---|
| `respondent` (owner perusahaan) | Token undangan, **tanpa akun** | Buka form undangannya, isi & kirim jawaban, lihat laporan hasilnya |
| `auditor` | Akun + JWT | Kelola perusahaan klien, terbitkan/cabut undangan, lihat semua laporan miliknya |
| `auditor_admin` | Akun + JWT | + kelola anggota tim auditor |
| `sysadmin` | Akun + JWT | Kelola bank pertanyaan, rubrik, benchmark |

Responden hanya dapat menyentuh assessment yang terikat pada token undangannya. Token tidak memberi akses ke daftar perusahaan atau assessment lain.

Matriks izin (RBAC) diberlakukan di layer API, bukan hanya UI.

## 2. Modul Autentikasi (auditor)
**FR-01 Registrasi auditor via email + OTP.**
- AC1: Email valid → OTP 6 digit terkirim, berlaku 10 menit, maks 5 percobaan.
- AC2: OTP salah 5x → akun terkunci 15 menit.
- AC3: Hanya email yang diundang `auditor_admin` atau terdaftar di allowlist yang dapat mendaftar. Publik tidak bisa membuat akun sendiri.

**FR-02 Login email + kata sandi.** Jalur masuk utama auditor; tidak ada login pihak ketiga (Google OAuth dihapus dari lingkup, lihat ADR-009).
- AC1: Kata sandi disimpan hanya sebagai hash ber-salt, tidak pernah polos.
- AC2: Email tidak dikenal dan kata sandi salah menghasilkan respons yang tidak dapat dibedakan.
- AC3: Kata sandi minimal 10 karakter; mengganti kata sandi menuntut kata sandi lama bila sudah ada.

**FR-03 Sesi.** AC: Access token JWT 15 menit, refresh token 30 hari rotatif; logout mencabut refresh token.

**FR-04 Undang anggota tim auditor.** AC: `auditor_admin` mengirim undangan; tautan berlaku 7 hari; peran ditetapkan saat undangan.

## 3. Modul Perusahaan Klien
**FR-05 Profil perusahaan klien** — field wajib: `name`, `industry`, `employee_band`; opsional `revenue_band`, `country`, `province`.
- AC1: `industry` harus dari enum terkendali (FRD §9).
- AC2: Perubahan profil setelah assessment `SCORED` tidak mengubah skor historis.
- AC3: Perusahaan klien selalu dimiliki oleh satu akun auditor; auditor lain tidak dapat melihatnya.

**FR-05b Ubah dan hapus perusahaan klien.**
- AC1: Perubahan bersifat sebagian; field yang tidak dikirim dibiarkan apa adanya.
- AC2: Kepemilikan dan tanggal pembuatan tidak dapat diubah lewat jalur ini.
- AC3: Menghapus perusahaan ikut menghapus assessment, jawaban, undangan, dan tautan bagikannya; tidak ada baris yatim yang tertinggal.
- AC4: Karena tidak dapat dibatalkan, antarmuka menuntut nama perusahaan diketik ulang sebelum menghapus.
- AC5: Perusahaan milik auditor lain membalas `404`, bukan `403`.

**FR-06 Daftar perusahaan klien.** AC: Auditor hanya melihat perusahaan miliknya sendiri; permintaan ke perusahaan milik auditor lain mengembalikan `404`, bukan `403`, agar keberadaannya tidak bocor.

## 4. Modul Assessment (inti)
**FR-07 Assessment dibuat bersama undangan.**
- Assessment tidak dibuat langsung oleh responden, melainkan otomatis saat auditor menerbitkan undangan (FR-23 AC3).
- AC1: Sistem menyematkan `questionnaire_version` dan `rubric_version` yang aktif saat itu ke assessment (immutable).
- AC2: Hanya boleh ada 1 assessment berstatus `IN_PROGRESS` per perusahaan; menerbitkan undangan baru saat masih ada yang aktif mengembalikan `409` beserta id yang berjalan.
- AC3: Setiap permintaan responden diautentikasi token undangan dan hanya boleh menyentuh assessment yang terikat token tersebut.

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
- Setiap pertanyaan dengan skor <= ambang pemicunya memicu satu atau lebih `Recommendation` dari katalog rule.
- Rekomendasi memiliki `impact` (1–5), `effort` (1–5), `horizon` (`0_3M`|`3_6M`|`6_12M`), `owner_role`, `estimated_cost_band`.
- AC1: Diurutkan berdasar `priority_score = impact / effort`, ambil top 10, minimal 3.
- AC2: Deduplikasi berdasarkan `recommendation_code`.
- AC3 **Relevansi**: rekomendasi yang seluruh pemicunya sudah terpenuhi (skor di atas ambang) tidak boleh muncul. Organisasi yang sudah matang menerima *rekomendasi lanjutan* berkode `REC-ADV-*` yang tidak memiliki pemicu, alih-alih disuruh mengerjakan hal yang sudah selesai.
- AC4 **Keseimbangan roadmap**: pemilihan menyisakan kuota 2 slot untuk horizon `3_6M` dan 1 slot untuk `6_12M`. Tanpa kuota, pengurutan `impact/effort` murni selalu dimenangkan quick win sehingga roadmap jangka menengah dan panjang selalu kosong. Di dalam kuota tersebut urutan memakai `impact` menurun, karena slot jangka panjang memang diperuntukkan bagi pekerjaan fondasi yang usahanya besar.
- AC5 **Urutan stabil**: hasil tidak bergantung pada urutan katalog masukan.

**FR-15 Benchmark.**
- AC1: Percentile dihitung terhadap assessment `SCORED` dalam 12 bulan terakhir pada `industry` + `employee_band` yang sama.
- AC2: Bila sampel < 30, fallback ke level `industry` saja; bila masih < 30, tampilkan `benchmark_available: false`, jangan tampilkan angka palsu.

## 6. Modul Laporan
**FR-16 Halaman hasil.** Menampilkan: verdict, skor total, radar 7 dimensi, tabel skor & level, benchmark bila tersedia, top rekomendasi, roadmap 3 horizon, confidence.
- AC1: Dapat diakses responden lewat token undangannya dan oleh auditor pemilik perusahaan.
- AC2: Seluruh bagian terbuka; tidak ada elemen yang diburamkan atau dikunci (FR-30).
**FR-17 Ekspor PDF.** AC: Dihasilkan server-side, konten identik halaman hasil, < 10 detik, disimpan ke object storage, tautan unduh berlaku 24 jam.
**FR-18 Share link.** AC: Token acak 32 byte, read-only, dapat dicabut, opsi kedaluwarsa 7/30/90 hari, opsi sembunyikan nama perusahaan.
**FR-19 Riwayat & tren.** AC: Grafik garis skor total & per dimensi antar assessment, minimal 2 assessment untuk ditampilkan.

## 7. Modul Admin (sysadmin)
**FR-20 CMS bank pertanyaan.** CRUD pertanyaan, opsi, bobot, aturan visibilitas; perubahan membuat `questionnaire_version` baru berstatus `DRAFT` → `PUBLISHED`.
**FR-21 Versi rubrik.** AC: Versi `PUBLISHED` tidak dapat diubah; hanya bisa dibuat versi baru.
**FR-22 Preview.** AC: sysadmin dapat menjalankan assessment uji pada versi `DRAFT` tanpa memengaruhi benchmark (`is_test = true`).

## 8. Modul Undangan & QR Code (inti model bisnis v2)
**FR-23 Terbitkan undangan.**
- Input: `company_id`, `type` (`FULL`), `expires_in_days` ∈ {7, 30, 90}, default 30.
- AC1: Sistem membuat token acak ≥ 32 byte dari CSPRNG, menyimpan **hash**-nya, dan hanya mengembalikan token mentah satu kali pada respons pembuatan.
- AC2: Respons memuat `invitation_url`, `qr_png_url`, `qr_svg_url`, `expires_at`, dan `status = SENT`.
- AC3: Sistem sekaligus membuat assessment berstatus `IN_PROGRESS` yang terikat pada undangan tersebut, dengan `questionnaire_version` dan `rubric_version` terkunci saat itu.
- AC4: Satu perusahaan hanya boleh punya satu undangan aktif per siklus; menerbitkan yang baru saat masih ada yang aktif mengembalikan `409` beserta `invitation_id` yang berjalan.

**FR-24 QR code undangan.**
- AC1: `GET /invitations/{id}/qr.png` dan `.svg` menghasilkan QR berisi `invitation_url` yang sama persis dengan tautan.
- AC2: QR dapat dipindai kamera bawaan Android dan iOS tanpa aplikasi tambahan; error correction level M, ukuran minimal 256×256 px untuk PNG.
- AC3: Varian cetak menyertakan nama perusahaan di bawah QR agar tidak tertukar antar klien.
- AC4: Endpoint QR memerlukan autentikasi auditor. QR tidak boleh dapat ditebak dari `company_id`.

**FR-25 Akses form oleh responden.**
- AC1: `GET /f/{token}` mengembalikan halaman sambutan: nama perusahaan, nama auditor pengundang, estimasi waktu, dan jumlah pertanyaan.
- AC2: Pembukaan pertama mengubah status `SENT` → `OPENED` dan mencatat `opened_at`.
- AC3: Token tidak valid, dicabut, atau kedaluwarsa mengembalikan `404` dengan pesan netral, tanpa membocorkan apakah token pernah ada.
- AC4: Responden **tidak perlu membuat akun**; token undangan adalah kredensial.
- AC5: Halaman form diberi header `X-Robots-Tag: noindex, nofollow` agar tidak terindeks mesin pencari.

**FR-26 Melanjutkan lintas perangkat.**
- AC1: Membuka tautan atau memindai QR yang sama dari perangkat berbeda menampilkan seluruh jawaban yang sudah tersimpan.
- AC2: Tidak ada penguncian sesi per perangkat; owner boleh mulai di HP dan menyelesaikan di laptop.

**FR-27 Cabut & terbitkan ulang undangan.**
- AC1: Auditor dapat mencabut undangan; `status = REVOKED` dan seluruh permintaan dengan token tersebut langsung ditolak `404`.
- AC2: Menerbitkan ulang menghasilkan token dan QR baru, sementara jawaban yang sudah tersimpan tetap dipertahankan pada assessment yang sama.

**FR-28 Kedaluwarsa & pengingat.**
- AC1: Setelah `expires_at` terlewat, status menjadi `EXPIRED` dan form ditolak, sekalipun pengisian belum selesai.
- AC2: Sistem mengirim pengingat pada H+3 dan H+7 untuk undangan berstatus `SENT` atau `OPENED` yang belum `SUBMITTED`.

**FR-29 Status undangan untuk dashboard auditor.**
- AC1: `GET /invitations` mengembalikan daftar milik auditor dengan `status`, `progress.percent`, `opened_at`, `submitted_at`.
- AC2: Transisi status yang sah: `SENT → OPENED → IN_PROGRESS → SUBMITTED → SCORED`, dengan `REVOKED` dan `EXPIRED` sebagai status terminal yang dapat dicapai dari status mana pun sebelum `SUBMITTED`.

**FR-30 Tidak ada paywall.**
- AC1: Seluruh bagian laporan dapat diakses oleh responden dan auditor tanpa pembayaran.
- AC2: Kode error `PAYMENT_REQUIRED` dan status HTTP `402` tidak boleh muncul di mana pun dalam sistem.

**FR-33 Perbarui profil sendiri.** Auditor dapat mengubah nama dan emailnya sendiri.
- AC1: Email juga merupakan kredensial masuk, sehingga yang baru harus langsung dapat dipakai login.
- AC2: Email yang sudah dipakai akun lain ditolak dengan `409`.
- AC3: Peran tidak dapat diubah lewat endpoint ini.

## 8b. Modul Tinjauan AI

**FR-31 Tinjauan AI atas jawaban satu assessment.** Skor tetap deterministik dari rubrik; AI hanya menilai kualitas jawaban.
- AC1: Hanya assessment berstatus `SCORED` yang dapat ditinjau; selain itu `409`.
- AC2: Hasil tinjauan disimpan sebagai snapshot dan dipakai ulang sampai diminta tinjau ulang secara eksplisit.
- AC3: Bila model tidak dikonfigurasi atau balasannya tidak sah, API membalas `503` dengan pesan jujur, bukan hasil karangan.
- AC4: Assessment milik auditor lain mengembalikan `404`.

**FR-32 Tinjauan massal.** Dibutuhkan karena satu auditor dapat memegang ratusan perusahaan.
- AC1: Hanya assessment milik auditor pemanggil yang diproses.
- AC2: Assessment yang sudah pernah ditinjau dilewati kecuali diminta menyegarkan.
- AC3: Kegagalan pada satu assessment tidak membatalkan sisa antrean.
- AC4: Antrean dikerjakan beberapa sekaligus dengan konkurensi terbatas, sehingga auditor tidak menunggu menit-menit; urutan hasil tetap stabil antar pemanggilan.

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
Kode: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INCOMPLETE, INVALID_ANSWER_TYPE, QUESTION_NOT_VISIBLE, INVITATION_INVALID, RATE_LIMITED, INTERNAL`.

`PAYMENT_REQUIRED` sengaja dihapus dari sistem (FR-30 AC2). `INVITATION_INVALID` dipakai saat token undangan tidak dikenal, dicabut, atau kedaluwarsa; responsnya selalu bergaya netral agar tidak membocorkan keberadaan token.

## 12. Matriks Telusur
| FR | Sumber BRD/PRD | Uji |
|---|---|---|
| FR-23, FR-24 | BA1, PA1, PA2, F03, F04 | Integrasi: terbitkan undangan, pindai isi QR, bandingkan dengan invitation_url |
| FR-25, FR-26 | BA2, BA5, PA3 | E2E: buka via token, isi sebagian di satu klien, lanjutkan di klien lain |
| FR-27, FR-28 | F17, PA6 | Integrasi: cabut lalu akses ulang → 404; lewati expires_at → 404 |
| FR-29 | F15 | Integrasi: status berubah mengikuti aksi responden |
| FR-30 | BA6, PA4 | Kontrak: tidak ada 402 maupun PAYMENT_REQUIRED di seluruh spec |
| FR-07..FR-13 | G1, F06, F07 | E2E: isi, tutup, lanjutkan di perangkat lain |
| FR-12, BR-01..BR-09 | BA3, PA5 | Unit: property test determinisme & monotonicity |
| FR-14 | BA4 | Unit: minimal 3 rekomendasi untuk semua profil, relevansi, kuota horizon |
| FR-16..FR-18 | G4, F11, F14 | Snapshot PDF versus HTML |
| FR-15 | F21 | Unit: fallback saat sampel < 30 |
| FR-02 | G1 | Integrasi: login benar/salah, ganti kata sandi, cookie sesi di web |
| FR-31, FR-32 | BA3 | Integrasi: tinjauan dengan model stub, caching snapshot, 503 saat model absen |
| FR-05b | F05 | Integrasi: ubah sebagian field, hapus berantai, isolasi antar auditor |
| FR-33 | G1 | Integrasi: ganti email lalu masuk memakai email baru, tolak email milik orang lain |
