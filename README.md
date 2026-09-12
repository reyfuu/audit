# SiapAI — Aplikasi Audit Kesiapan AI untuk Bisnis

Aplikasi web yang menilai apakah sebuah bisnis sudah siap mengadopsi AI, melalui form assessment terstruktur pada 7 dimensi, skoring deterministik, dan laporan berisi gap analysis serta roadmap.

## Status
Fase dokumentasi selesai. Implementasi belum dimulai (menunggu persetujuan dokumen).

## Dokumen
| Dokumen | Isi |
|---|---|
| [docs/BRD.md](docs/BRD.md) | Masalah bisnis, tujuan, KPI, model bisnis, risiko |
| [docs/PRD.md](docs/PRD.md) | Persona, fitur & prioritas, alur pengguna, model 7 dimensi, rilis |
| [docs/FRD.md](docs/FRD.md) | Requirement fungsional FR-01..FR-24 dengan kriteria penerimaan, business rule skoring |
| [docs/TRD.md](docs/TRD.md) | Arsitektur, tumpukan teknologi, model data, keamanan, kinerja, pengujian |
| [DESIGN.md](DESIGN.md) | ADR, alur sistem, design token, peta layar, wireframe, komponen, aksesibilitas |
| [docs/QUESTION_BANK.md](docs/QUESTION_BANK.md) | Isi form: ~45 pertanyaan berskor + Quick Check + aturan rekomendasi |
| [contracts/openapi.yaml](contracts/openapi.yaml) | API contract OpenAPI 3.1 (32 path, 45 schema) |

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
2. Scaffold monorepo (`apps/web`, `apps/api`, `packages/scoring`).
3. Implementasi mesin skoring + uji determinisme lebih dulu.
4. Form assessment dan halaman hasil.
