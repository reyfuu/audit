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
| [docs/FRD.md](docs/FRD.md) | FR-01..FR-30 + AC yang dapat diuji, business rule skoring |
| [docs/TRD.md](docs/TRD.md) | Arsitektur Elysia/Bun, ERD, keamanan token, kinerja, strategi tes |
| [DESIGN.md](DESIGN.md) | ADR, state machine, design token, wireframe, komponen |
| [docs/QUESTION_BANK.md](docs/QUESTION_BANK.md) | Isi form: 43 pertanyaan berskor + katalog rekomendasi |
| [contracts/openapi.yaml](contracts/openapi.yaml) | API contract OpenAPI 3.1 |
| [tools/validate_docs.py](tools/validate_docs.py) | Validator konsistensi dokumen & kontrak |

## Tumpukan Teknologi
**Backend: Elysia di atas Bun** (TypeBox schema-first, Eden untuk tipe end-to-end), PostgreSQL 16 + Drizzle ORM, Redis/BullMQ untuk job PDF & email, `qrcode` untuk QR server-side.
**Frontend:** Next.js 15 + Tailwind + shadcn/ui. Rincian di [docs/TRD.md](docs/TRD.md) §2 dan ADR-007/008 di [DESIGN.md](DESIGN.md).

## Implementasi
| Paket | Isi | Status |
|---|---|---|
| `packages/scoring` | Mesin skoring murni: 7 dimensi, hard gate, rekomendasi, DSL visibilitas, kuesioner v1 | Selesai, 90 uji |
| `apps/api` | Elysia: perusahaan klien, undangan + QR, jalur responden bertoken | Selesai, 36 uji |
| `apps/web` | Form mobile-first & halaman hasil | Berikutnya |

```bash
bun run verify   # typecheck + validator dokumen + semua uji
bun run demo     # skor 3 profil bisnis contoh
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
| Mesin skoring & rekomendasi | `bun test packages/scoring` | 90/90 lulus |
| Alur undangan, QR, dan pengisian | `bun test apps/api` | 36/36 lulus |
| Type safety (strict) | `bunx tsc --noEmit` | bersih |

QR code diuji dengan **mendekodenya kembali** memakai `jsqr`, lalu memastikan isinya sama persis dengan `invitation_url` dan token hasil pindai benar-benar membuka form perusahaan yang tepat. Uji scoring mencakup property test determinisme (200 profil acak) dan monotonicity (150 profil).
