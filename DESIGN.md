# DESIGN.md — Desain Sistem & Antarmuka
**Produk:** SiapAI · **Versi:** 1.0 · **Tanggal:** 2026-09-12

---

## Bagian A — Desain Sistem

### A1. Keputusan Arsitektur (ADR ringkas)
| ADR | Keputusan | Alternatif ditolak | Alasan |
|---|---|---|---|
| ADR-001 | Modular monolith **Elysia di atas Bun** | Microservices | Tim kecil, domain belum stabil |
| ADR-002 | Skoring sebagai paket murni terisolasi | Logika di service/DB | Determinisme & testability (BA2) |
| ADR-003 | Konten kuesioner di DB, berversi | Hardcode di kode | Konten berubah lebih cepat dari kode |
| ADR-004 | Snapshot hasil skoring (JSONB) | Hitung ulang saat render | Laporan historis harus stabil (PA4) |
| ADR-005 | PDF via render halaman hasil (Playwright) | Template PDF terpisah | Cegah drift HTML vs PDF (PA3) |
| ADR-006 | OpenAPI sebagai sumber kebenaran | Tipe manual | Sinkron FE/BE, uji kontrak otomatis |
| ADR-007 | **Elysia + TypeBox menggantikan NestJS** | NestJS, Fastify, Hono | Skema validasi runtime sekaligus menghasilkan OpenAPI (menguatkan ADR-006), throughput lebih tinggi untuk endpoint autosave yang paling sering dipanggil, dan tipe end-to-end ke frontend via Eden tanpa codegen. Konsekuensi: ekosistem lebih muda, pustaka pihak ketiga yang belum matang di Bun diisolasi di balik adapter. |
| ADR-008 | Drizzle ORM menggantikan Prisma | Prisma, SQL mentah | Berjalan native di Bun tanpa engine biner, migrasi SQL eksplisit yang cocok dengan strategi expand-and-contract |
| ADR-009 | Form responden server-rendered dengan progressive enhancement | SPA React/Next | Jalur masuk utama adalah pindai QR di HP, sering pada koneksi seluler buruk. SPA yang gagal dimuat mematikan satu-satunya kesempatan owner mengisi. Form HTML biasa tetap berfungsi tanpa JavaScript; JS hanya menambah autosave. Terverifikasi: halaman 8.7 KB dan alur penuh selesai dengan `javaScriptEnabled: false`. |
| ADR-010 | Seksi profil `ORG` terpisah dari tujuh dimensi berskor | Menitipkan pertanyaan profil ke dimensi STR | Menitipkan membuat UI melabeli "Berapa jumlah karyawan" sebagai "Strategi & Kepemimpinan", yang menyesatkan responden. Ditemukan lewat pemeriksaan visual, bukan uji unit. |
| ADR-011 | Antarmuka `Repo` asinkron sejak awal, termasuk implementasi memori | Antarmuka sinkron dengan pembungkus asinkron terpisah | Penyimpanan nyata selalu melakukan I/O. Menyeragamkan bentuknya membuat Postgres dapat dipasang tanpa mengubah satu baris pun di modul HTTP, dan uji kontrak yang sama dapat dijalankan terhadap kedua implementasi. |
| ADR-012 | Uji kontrak penyimpanan dijalankan terhadap memori dan Postgres nyata | Hanya menguji memori, atau hanya Postgres | Menguji memori saja tidak membuktikan SQL benar; menguji Postgres saja membuat uji lambat dan menuntut basis data. Menjalankan suite yang sama pada keduanya menjamin perilakunya identik sekaligus menjaga uji cepat secara default. |
| ADR-013 | Refresh token rotatif sekali pakai dengan pencabutan sekeluarga | Refresh token berumur panjang yang dipakai berulang | Token berumur panjang yang bocor memberi akses berkepanjangan tanpa jejak. Dengan rotasi, pemakaian ulang adalah sinyal kuat token dicuri; mencabut seluruh keluarga memaksa login ulang. Konsekuensinya pengguna sah bisa ikut terputus, dan itu diterima sebagai harga keamanan. |
| ADR-014 | Token pintasan dikunci di balik `ALLOW_DEV_TOKENS` dan mati di produksi | Menghapusnya sama sekali, atau membiarkannya selalu aktif | Menghapus membuat 80 uji alur bisnis harus menjalankan login OTP penuh dan menjadi lambat serta berisik. Membiarkannya aktif berarti mengetahui id auditor sudah cukup untuk masuk. Mengunci di balik variabel lingkungan menjaga uji tetap ringkas tanpa meninggalkan pintu belakang. |
| ADR-015 | PDF dirender lewat tautan bagikan internal berumur 5 menit | Merender dengan sesi auditor, atau membangun template PDF terpisah | Perender adalah browser tanpa kepala yang tidak membawa sesi auditor. Menyuntikkan kredensial ke browser berisiko bocor; template terpisah melanggar ADR-005 karena isinya bisa menyimpang dari layar. Tautan internal berumur pendek yang selalu dicabut setelah render, termasuk saat gagal, menjaga keduanya. |
| ADR-016 | Otorisasi tidak pernah bergantung pada header dari klien | Header `X-Company-Id` seperti rancangan v1 | Header apa pun dapat dipalsu pemanggil. Scope auditor ditentukan `owner_auditor_id` di layer data, dan jalur publik ditentukan tokennya sendiri. Validator kontrak menegakkan larangan ini agar tidak kembali menyelinap. |

### A2. Mesin Skoring — alur
```mermaid
sequenceDiagram
  participant U as User
  participant API as Assessment API (Elysia)
  participant S as Scoring Engine
  participant DB as Postgres
  U->>API: POST /assessments/{id}/submit
  API->>DB: ambil answers + questionnaire_version + rubric
  API->>S: score(answers, questionnaire, rubric)
  S-->>API: {total, dimensions[], verdict, gates, confidence}
  API->>S: recommend(breakdown, catalog)
  S-->>API: recommendations[] terurut
  API->>DB: simpan score_results + dimension_scores + recommendation_items
  API-->>U: 200 ScoreResult
```

### A3. State machine assessment
```mermaid
stateDiagram-v2
  [*] --> IN_PROGRESS: create
  IN_PROGRESS --> IN_PROGRESS: patch answers (autosave)
  IN_PROGRESS --> SUBMITTED: submit (lengkap)
  IN_PROGRESS --> [*]: delete draft
  SUBMITTED --> SCORED: scoring selesai
  SCORED --> ARCHIVED: arsipkan
```

### A4. Strategi autosave & konflik
- Klien mengirim batch `PATCH` dengan `client_revision` naik monoton.
- Server menerapkan last-write-wins per `question_code` dan mengembalikan `server_revision`.
- Bila `server_revision` lebih besar dari yang diketahui klien (tab lain), klien refetch dan menampilkan banner "jawaban diperbarui dari sesi lain".
- Offline: antrean di IndexedDB, flush saat online.

### A5. Model konten
Satu `questionnaire_version` memuat dimensi, pertanyaan, opsi, bobot, aturan visibilitas, dan pemetaan rekomendasi. `PUBLISHED` bersifat immutable. Assessment mengunci versi saat dibuat.

---

## Bagian B — Desain Antarmuka

### B1. Prinsip
1. **Satu pertanyaan, satu keputusan** — hindari dinding formulir.
2. **Selalu tunjukkan kemajuan** — pengguna tahu sisa waktu.
3. **Bahasa manusia** — hindari jargon; sediakan contoh konkret di help text.
4. **Tidak ada jalan buntu** — skor rendah selalu disertai langkah berikutnya.
5. **Aksesibel** — WCAG 2.1 AA, navigasi keyboard penuh, kontras ≥ 4.5:1.

### B2. Design token
```
Warna
  brand-900 #0B2E4F   brand-600 #1467B3   brand-300 #7FB3E3
  ok   #1B9E5A    warn #E8A317    danger #D64545    neutral-900 #111827
  bg   #F7F9FC    surface #FFFFFF   border #E3E8EF
Level maturitas: L1 #D64545 · L2 #E8734A · L3 #E8A317 · L4 #7BB661 · L5 #1B9E5A
Tipografi  Inter; H1 32/40 semibold · H2 24/32 · Body 16/26 · Caption 13/18
Spasi      skala 4px (4,8,12,16,24,32,48,64)
Radius     8px kartu, 6px input, 999px pill
Bayangan   sm 0 1px 2px rgba(16,24,40,.06) · md 0 4px 12px rgba(16,24,40,.08)
Breakpoint sm 640 · md 768 · lg 1024 · xl 1280
```

### B3. Peta layar
| Layar | Rute | Isi utama |
|---|---|---|
| **Form sambutan (responden)** | `/f/{token}` | Nama perusahaan, pengundang, estimasi waktu, tombol mulai atau lanjutkan |
| **Form pengisian (responden)** | `/f/{token}/isi` | Satu pertanyaan per layar, mobile-first |
| **Review (responden)** | `/f/{token}/review` | Daftar jawaban dan yang masih kosong |
| **Hasil (responden)** | `/f/{token}/hasil` | Radar, dimensi, rekomendasi, roadmap, terbuka penuh |
| Login auditor | `/masuk` | Email + OTP |
| Dashboard auditor | `/app` | Daftar undangan beserta status dan progres |
| Perusahaan klien | `/app/perusahaan/{id}` | Profil, riwayat audit, tren |
| **Terbitkan undangan** | `/app/perusahaan/{id}/undang` | Form penerbitan, menampilkan tautan + QR siap unduh |
| Hasil (auditor) | `/app/assessments/{id}/hasil` | Sama dengan tampilan responden, plus catatan auditor |
| Admin CMS | `/admin/questionnaires` | Kelola konten berversi |

### B4. Tata letak layar assessment
```
┌──────────────────────────────────────────────────────────────┐
│  SiapAI          Assessment Kesiapan AI        Tersimpan ✓   │
├───────────────┬──────────────────────────────────────────────┤
│ PROGRES 42%   │  Dimensi 2 dari 7 — DATA                     │
│ ● Strategi  ✓ │                                              │
│ ◐ Data        │  Pertanyaan 3 dari 8                         │
│ ○ Teknologi   │  ─────────────────────────────────────────   │
│ ○ SDM         │  Seberapa mudah tim Anda mengakses data      │
│ ○ Proses      │  operasional untuk analisis?                 │
│ ○ Tata Kelola │                                              │
│ ○ Finansial   │  ( ) Harus minta manual ke IT, berhari-hari  │
│               │  ( ) Ada ekspor berkala mingguan/bulanan     │
│ ⏱ ±14 menit   │  (•) Ada dashboard self-service              │
│               │  ( ) Ada akses API/warehouse terdokumentasi  │
│               │  ( ) Real-time, bertata kelola, self-service │
│               │                                              │
│               │  ⓘ Contoh: jika analis harus WA staf IT      │
│               │    untuk minta ekspor, pilih opsi pertama.   │
│               │                                              │
│               │  [ Lampirkan bukti (opsional) ]              │
│               │                        [ Kembali ] [ Lanjut ]│
└───────────────┴──────────────────────────────────────────────┘
```

### B5. Tata letak halaman hasil
```
┌──────────────────────────────────────────────────────────────┐
│  VERDICT: CONDITIONALLY READY            Skor 58.4 / 100     │
│  Level 3 — Defined            Keyakinan: Sedang              │
│  ⚠ Gate: Fondasi data Anda (36.0) di bawah ambang 40         │
├───────────────────────────────┬──────────────────────────────┤
│        [ RADAR 7 DIMENSI ]    │  Strategi      72  L4  ▰▰▰▰  │
│                               │  Data          36  L2  ▰▰    │
│      Anda ── Median industri  │  Teknologi     61  L4  ▰▰▰▰  │
│                               │  SDM           48  L3  ▰▰▰   │
│  Persentil industri: ke-62    │  Proses        55  L3  ▰▰▰   │
│  (n=141, Retail, 50–99)       │  Tata Kelola   40  L3  ▰▰▰   │
│                               │  Finansial     66  L4  ▰▰▰▰  │
├───────────────────────────────┴──────────────────────────────┤
│  3 LANGKAH PRIORITAS                                         │
│  1. Bangun katalog data & satu sumber kebenaran  Dampak 5/5  │
│     Usaha 2/5 · 0–3 bln · Owner: Head of IT · Rp 10–30 jt    │
│  2. Tetapkan kebijakan penggunaan AI & PDP       Dampak 4/5  │
│  3. Latih 5 champion data di tiap divisi         Dampak 4/5  │
├──────────────────────────────────────────────────────────────┤
│  ROADMAP   [0–3 bln] [3–6 bln] [6–12 bln]                    │
│  [ Unduh PDF ]  [ Bagikan tautan ]  [ Jadwalkan ukur ulang ] │
└──────────────────────────────────────────────────────────────┘
```

### B6. Komponen kunci
| Komponen | Perilaku |
|---|---|
| `QuestionCard` | Satu pertanyaan, opsi radio besar (target sentuh ≥ 44px), help text dapat dibuka, autofokus |
| `ProgressSidebar` | Status per dimensi, klik untuk lompat, estimasi waktu tersisa |
| `SaveIndicator` | `Menyimpan… / Tersimpan ✓ / Gagal — coba lagi` |
| `RadarChart` | Skor pengguna vs median industri; aria-label berisi nilai numerik |
| `ScoreBar` | Warna mengikuti level, selalu disertai angka (bukan warna saja) |
| `RecommendationCard` | Judul, dampak/usaha, horizon, owner, estimasi biaya, aksi "tandai dikerjakan" |
| `EmptyState` | Ilustrasi + satu CTA jelas |

### B7. Status & penanganan kesalahan di UI
| Status | Perilaku |
|---|---|
| Loading | Skeleton, bukan spinner penuh layar |
| Autosave gagal | Banner kuning persisten + tombol coba lagi; data disimpan lokal |
| Submit tidak lengkap | Daftar pertanyaan kurang, klik untuk melompat ke pertanyaan |
| Benchmark tidak tersedia | Sembunyikan persentil, tampilkan "Data pembanding belum cukup" |
| Undangan dicabut/kedaluwarsa | Halaman netral: "Tautan ini sudah tidak berlaku. Hubungi auditor Anda untuk tautan baru." Tanpa membocorkan apakah token pernah ada |

### B8. Aksesibilitas & konten
- Setiap input punya `<label>`; grup radio memakai `fieldset/legend`.
- Fokus terlihat, urutan tab logis, pengumuman `aria-live` saat autosave & error.
- Bahasa Indonesia formal-ramah; hindari "leverage", "synergy"; jelaskan istilah teknis pada help text.

### B9. Kinerja frontend
Target LCP < 2.5 s pada 4G, JS awal < 180 KB gzip, chart di-lazy load, halaman pertanyaan diprefetch satu langkah ke depan.
