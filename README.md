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
| [tools/validate_docs.py](tools/validate_docs.py) | Validator konsistensi dokumen & kontrak (66 check) |

## Tumpukan Teknologi
**Backend: Elysia di atas Bun** (TypeBox schema-first, Eden untuk tipe end-to-end), PostgreSQL 16 + Drizzle ORM, Redis/BullMQ untuk job PDF & email.
**Frontend:** Next.js 15 + Tailwind + shadcn/ui. Rincian dan alasan di [docs/TRD.md](docs/TRD.md) §2 dan ADR-007/008 di [DESIGN.md](DESIGN.md).

## Validasi
```bash
python3 tools/validate_docs.py    # konsistensi lintas dokumen
```
Memeriksa keselarasan enum, bobot dimensi, kode error, endpoint yang dijanjikan FRD, aturan auth, dan konsistensi stack.

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

## Bukti Verifikasi
| Check | Perintah | Hasil |
|---|---|---|
| Konsistensi dokumen & kontrak | `python3 tools/validate_docs.py` | 69/69 lulus |
| OpenAPI 3.1 sah | `openapi-spec-validator contracts/openapi.yaml` | VALID |
| Pola arsitektur Elysia jalan | `cd tools/spike-elysia && bun test` | 12/12 lulus |

Validator terbukti dapat gagal (mutation test): menghapus endpoint submit, mengubah bobot dimensi, menambah kode error fiktif, dan mengembalikan sebutan NestJS semuanya terdeteksi sebagai FAIL.
