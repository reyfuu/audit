# SiapAI — Aplikasi Audit Kesiapan AI untuk Bisnis

Alat audit berbasis **undangan**. Auditor menerbitkan satu form assessment untuk sebuah perusahaan, lalu owner mengisinya lewat tautan atau **memindai QR code dari HP**, tanpa perlu membuat akun. Sistem menghasilkan skor 7 dimensi, verdict siap atau belum, dan roadmap rekomendasi.

Tidak ada tier gratis, paywall, atau penjualan mandiri di dalam aplikasi.

## Alur
```
Auditor  ──terbitkan undangan──>  tautan + QR code
                                        │
Owner    ──pindai QR / klik tautan──────┘
         ──isi form (autosave, mobile-first, bisa dilanjut di perangkat lain)
         ──kirim──>  skor + verdict + roadmap, terbuka penuh
```

## Dokumen
| Dokumen | Isi |
|---|---|
| [docs/BRD.md](docs/BRD.md) | Masalah bisnis, KPI, model undangan, risiko |
| [docs/PRD.md](docs/PRD.md) | Persona, 21 fitur, alur undangan & QR, prinsip mobile-first |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Instalasi VPS: push-pull, systemd, nginx, TLS, seed akun demo |
| [docs/FRD.md](docs/FRD.md) | FR-01..FR-33 + AC yang dapat diuji, business rule skoring |
| [docs/TRD.md](docs/TRD.md) | Arsitektur Elysia/Bun, ERD, keamanan token, kinerja, strategi tes |
| [DESIGN.md](DESIGN.md) | ADR, state machine, design token, wireframe, komponen |
| [docs/QUESTION_BANK.md](docs/QUESTION_BANK.md) | Isi form: 43 pertanyaan berskor + katalog rekomendasi |
| [contracts/openapi.yaml](contracts/openapi.yaml) | API contract OpenAPI 3.1 |
| [tools/validate_docs.py](tools/validate_docs.py) | Validator konsistensi dokumen & kontrak |

## Tumpukan Teknologi
**Backend: Elysia di atas Bun** (TypeBox schema-first, Eden untuk tipe end-to-end), PostgreSQL 16 + Drizzle ORM, Redis/BullMQ untuk job PDF & email, `qrcode` untuk QR server-side.
**Frontend:** Next.js 15 + Tailwind + shadcn/ui. Rincian di [docs/TRD.md](docs/TRD.md) §2 dan ADR-007/008 di [DESIGN.md](DESIGN.md).

## Demo Langsung
**<https://audit.aipreneur.co.id>** — masuk dengan `admin@example.com` / `password123`.

Berjalan di VPS dengan PostgreSQL, tinjauan AI aktif, dan lima perusahaan
contoh pada kondisi berbeda. Rincian instalasinya di
[docs/DEPLOY.md](docs/DEPLOY.md).

## Status Implementasi
Kontrak API sengaja ditulis lebih dulu dan lebih luas daripada implementasinya.
Tiap path diberi `x-status`, dan `tools/traceability.py` memverifikasi penandaan
itu jujur, sehingga status tidak pernah dilaporkan lebih baik dari kenyataan.

| Paket | Isi | Status |
|---|---|---|
| `packages/scoring` | Mesin skoring: 7 dimensi, hard gate, rekomendasi, DSL visibilitas, kuesioner v1 | Berjalan, 92 uji |
| `packages/ai` | Klien 9router + tinjauan AI atas kualitas jawaban | Berjalan, 14 uji |
| `apps/api` | Perusahaan klien (CRUD penuh), undangan + QR, jalur responden bertoken | Berjalan, 158 uji |
| `apps/web` | Form responden mobile-first + dashboard auditor bersidebar (masuk, undangan, QR, status, tinjauan AI, akun & tim) | Berjalan, 118 uji |
| `apps/api/src/db` | Skema Drizzle + repo PostgreSQL, migrasi siap pakai | Berjalan, 16 uji kontrak |
| `apps/api` auth | Login email+kata sandi (dan OTP), JWT 15 menit, refresh rotatif, undangan tim | Berjalan, 44 uji |
| `apps/api` laporan | Ekspor PDF & tautan bagikan read-only | Berjalan, 19 uji |
| `apps/api` tinjauan AI | Tinjauan kualitas jawaban per assessment dan massal | Berjalan, 13 uji |

### Laporan
- **Unduh PDF**: dibuat dengan merender halaman laporan yang sama persis, lewat
  tautan internal berumur 5 menit yang selalu dicabut setelahnya, termasuk bila
  render gagal. PDF A4 dengan warna dan meteran skor ikut tercetak.
- **Tautan bagikan**: read-only, tanpa akun, dapat dicabut kapan saja, punya
  masa berlaku 7/30/90 hari, menghitung berapa kali dibuka, dan menyediakan
  opsi menyembunyikan nama perusahaan.

### Tinjauan AI
Skor kesiapan **tetap deterministik** dari rubrik; AI tidak pernah mengubah angka.
Yang dikerjakan AI adalah hal yang tidak dapat dilihat aturan: jawaban yang saling
bertentangan, klaim matang tanpa fondasi, pola pengisian asal-asalan, dan
pertanyaan konfirmasi yang perlu diajukan auditor sebelum laporan dikirim.

- Model diakses lewat 9router (kompatibel OpenAI), default `ag/gemini-3.8-flash-medium`.
- Hasil tinjauan disimpan sebagai snapshot, jadi membuka laporan tidak memanggil
  model berulang; biaya tetap terkendali saat jumlah perusahaan bertambah.
- Tersedia tinjauan massal untuk antrean yang belum pernah ditinjau, karena satu
  auditor dapat memegang ratusan perusahaan. Antrean dikerjakan empat sekaligus:
  diukur pada model sungguhan, 8 tinjauan turun dari 63 detik menjadi 22 detik.
- Bila kunci belum disetel atau balasan model tidak sah, API membalas `503`
  dengan pesan jujur, bukan hasil karangan.

```bash
AI_API_KEY=sk-xxx bun run demo:lokal      # aktifkan tinjauan AI
# opsional: AI_BASE_URL, AI_MODEL
```

### Keamanan autentikasi
- Kata sandi disimpan sebagai **hash scrypt ber-salt**, tidak pernah polos.
- Login email salah dan kata sandi salah memberi respons yang tidak dapat dibedakan.
- Sesi web disimpan di cookie **HttpOnly SameSite=Lax**, bukan localStorage, dan
  disegarkan diam-diam lewat refresh token rotatif saat access token kedaluwarsa.
- Kode OTP dan refresh token disimpan sebagai **hash**, tidak pernah polos.
- OTP: 6 digit dari CSPRNG, berlaku 10 menit, maksimal 5 percobaan.
- Refresh token **rotatif sekali pakai**. Pemakaian ulang dianggap indikasi
  token dicuri, sehingga seluruh keluarga sesi dicabut sekaligus.
- Publik tidak bisa mendaftar sendiri; hanya email yang diundang `auditor_admin`.
- Anggota tim yang baru diundang belum punya kata sandi, sehingga ia masuk lewat
  kode sekali pakai di `/masuk/kode` lalu menetapkan kata sandinya di halaman akun.
- Respons permintaan OTP identik untuk email terdaftar maupun tidak, agar tidak
  menjadi orakel daftar auditor.
- Token pintasan `Bearer user:<id>` hanya hidup bila `ALLOW_DEV_TOKENS=1`, dan
  **tidak pernah** aktif saat `NODE_ENV=production`.

**Alur utama sudah utuh:** auditor menerbitkan undangan → QR/tautan → owner mengisi → skor dan rekomendasi keluar.

**Yang masih berupa kontrak, belum ada kodenya (10 endpoint):**
hapus draft (FR-13), riwayat & tren (FR-19), CMS bank pertanyaan (FR-20..FR-22),
dan benchmark industri sebagai endpoint tersendiri (FR-15 dasarnya sudah ada).
Login pihak ketiga sengaja tidak ada: auditor masuk dengan email dan kata sandi.

```bash
python3 tools/traceability.py   # peta FRD -> implementasi -> uji
```

## Mencoba di Lokal

```bash
bun install
bun run demo:lokal
```

Perintah itu menyalakan API, form responden, dan dashboard auditor sekaligus,
lalu mencetak semua tautan yang dibutuhkan.

**Akun demo** — masuk di `http://localhost:3000` dengan
`admin@example.com` / `password123`.

| Buka | Isinya |
|---|---|
| `http://localhost:3000` | Halaman masuk auditor (email + kata sandi) |
| `http://localhost:3000/app` | Ringkasan: yang berjalan, yang macet, yang siap |
| `http://localhost:3000/app/undangan` | Daftar undangan dengan pencarian dan saringan status |
| `http://localhost:3000/app/perusahaan` | Daftar perusahaan klien dan penambahannya |
| `http://localhost:3000/app/tinjauan` | Tinjauan AI, termasuk tinjauan massal |
| `http://localhost:3000/app/akun` | Profil sendiri, kata sandi, dan undangan anggota tim |
| Tautan "COBA ISI FORM SENDIRI" | Form kosong siap diisi dari awal |
| Tautan "LAPORAN" | Contoh laporan yang sudah jadi |

Sembilan perusahaan contoh disiapkan pada kondisi berbeda: belum dibuka, sedang
diisi separuh, sudah selesai beserta laporannya, dan sisanya sebagai isi daftar
agar pencarian serta paginasi terasa seperti kondisi nyata.

### Dengan penyimpanan permanen
Secara default demo memakai memori, sehingga datanya hilang saat proses berhenti.
Untuk menyimpan permanen ke PostgreSQL:

```bash
bun run db:setup                                              # buat database & jalankan migrasi
DATABASE_URL=postgres://localhost:5432/siapai_dev bun run demo:lokal
```

Jawaban owner, undangan, dan laporan akan bertahan meski proses dimatikan dan
dijalankan ulang. Tautan serta QR yang sudah dibagikan tetap berlaku.

### Mencoba dari HP
1. Buka halaman detail undangan di laptop, QR-nya langsung tampil.
2. Pindai dengan kamera bawaan HP.
3. Agar HP dapat menjangkau laptop, keduanya harus satu Wi-Fi dan servernya
   dijalankan dengan alamat yang dapat diakses:
   ```bash
   PUBLIC_BASE_URL=http://192.168.x.x:3000 bun run demo:lokal
   ```

> Data demo disimpan di memori. Menghentikan proses akan menghapus semuanya.

## Perintah Lain
```bash
bun run start         # jalankan produksi (API + web satu proses)
bun run seed          # siapkan akun demo di penyimpanan permanen
bun run verify        # typecheck + validator dokumen + keterlacakan + semua uji
bun run verify:pg     # semua di atas, ditambah uji terhadap PostgreSQL nyata
bun run verify:all    # SEMUA loop termasuk pemeriksaan visual dan spike (lambat)
bun run check:visual  # verifikasi di viewport iPhone sungguhan (Playwright)
bun run demo          # cetak skor 3 profil bisnis contoh ke terminal
bun run dev           # sama dengan demo:lokal
```

## Model Kesiapan
| Dimensi | Bobot |
|---|---|
| Data | 25% |
| Strategi & Kepemimpinan | 15% |
| Teknologi & Infrastruktur | 15% |
| SDM & Keterampilan | 15% |
| Proses & Operasi | 10% |
| Tata Kelola & Kepatuhan | 10% |
| Finansial & Nilai | 10% |

Verdict: `READY ≥70` · `CONDITIONALLY_READY 50–69` · `NOT_READY <50`, dengan hard gate pada dimensi Data (<40) dan Tata Kelola (<30).

## Langkah Berikutnya
1. Review & persetujuan dokumen.
2. Scaffold monorepo Bun (`apps/web`, `apps/api` Elysia, `packages/scoring`).
3. Implementasi mesin skoring + uji determinisme lebih dulu.
4. Form assessment dan halaman hasil.

## Implementasi
| Paket | Isi | Status |
|---|---|---|
| `packages/scoring` | Mesin skoring murni: skor 7 dimensi, hard gate, rekomendasi berprioritas, DSL visibilitas, kuesioner v1 (43 pertanyaan + 23 rekomendasi) | Selesai, 90 uji |
| `apps/api` | Elysia (Bun) | Berikutnya |
| `apps/web` | Next.js form & laporan | Berikutnya |

```bash
bun run verify   # typecheck + validator dokumen + uji scoring
bun run demo     # skor 3 profil bisnis contoh
bun run test     # semua uji termasuk spike Elysia
```

## Bukti Verifikasi
| Check | Perintah | Hasil |
|---|---|---|
| Konsistensi dokumen & kontrak | `python3 tools/validate_docs.py` | 96/96 lulus |
| OpenAPI 3.1 sah | `openapi-spec-validator contracts/openapi.yaml` | VALID |
| Mesin skoring & rekomendasi | `bun test packages/scoring` | 92/92 lulus |
| Klien model & tinjauan AI | `bun test packages/ai` | 14/14 lulus |
| Alur undangan, QR, dan pengisian | `bun test apps/api` | 158/158 lulus |
| Form web, login, akun tim, dan dashboard bersidebar | `bun test apps/web` | 118/118 lulus |
| Tampilan di iPhone + dashboard + laporan bagikan | `bun run check:visual` | 50/50 lulus |
| Autentikasi & skenario serangan | `bun test apps/api/test/auth.test.ts` | 44/44 lulus |
| Tautan bagikan & ekspor PDF | `bun test apps/api/test/report.test.ts` | 19/19 lulus |
| Tinjauan AI, kepemilikan data, dan konkurensi antrean | `bun test apps/api/test/ai-review.test.ts` | 15/15 lulus |
| Kontrak penyimpanan (memori & Postgres) | `bun run test:pg` | 185/185 lulus |
| Type safety (strict) | `bunx tsc --noEmit` | bersih |
| Keterlacakan FRD → kode → uji | `python3 tools/traceability.py` | 28 siap, 5 ditunda, 0 bermasalah |
| Akurasi klaim README itu sendiri | `python3 tools/verify_readme.py` | 10/10 terverifikasi |

Angka di tabel ini tidak ditulis tangan begitu saja: `tools/verify_readme.py`
menjalankan perintahnya dan menolak bila README mengklaim lebih dari kenyataan.
Penandaan `x-status` di kontrak juga ditegakkan uji yang benar-benar memanggil
tiap endpoint, sehingga menandai sesuatu "sudah ada" padahal belum akan gagal.

Suite kontrak penyimpanan dijalankan terhadap implementasi memori **dan**
PostgreSQL nyata, sehingga keduanya dijamin berperilaku identik. Uji persistensi
memakai koneksi baru di tiap tahap untuk meniru server yang di-restart, dan
membuktikan jawaban owner tidak hilang.

Pemeriksaan visual menjalankan Chromium pada viewport iPhone 13 dan mengukur hal yang tidak dapat dibuktikan uji string: target sentuh terhitung ≥ 44px, tidak ada scroll horizontal, kontras 17.7:1, dan form benar-benar selesai dengan 43 ketukan. Alur juga diuji ulang dengan `javaScriptEnabled: false`. Dashboard auditor, halaman masuk, sidebar, QR, dan laporan bagikan ikut diperiksa, termasuk membuka laporan dari konteks browser yang sama sekali tanpa sesi.

QR code diuji dengan **mendekodenya kembali** memakai `jsqr`, lalu memastikan isinya sama persis dengan `invitation_url` dan token hasil pindai benar-benar membuka form perusahaan yang tepat. Uji scoring mencakup property test determinisme (200 profil acak) dan monotonicity (150 profil).
