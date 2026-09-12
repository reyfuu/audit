# TRD — Technical Requirements Document
**Produk:** SiapAI · **Versi:** 2.0 · **Tanggal:** 2026-09-12

> **Perubahan dari v1.0:** modul pembayaran dihapus. Ditambahkan modul undangan
> dan pembuatan QR code server-side, serta autentikasi responden berbasis token.

---

## 1. Prinsip Arsitektur
1. **Deterministik & auditable** — skoring adalah fungsi murni, hasilnya di-snapshot; rubrik berversi.
2. **Konten sebagai data** — pertanyaan, bobot, aturan visibilitas, rekomendasi disimpan di DB, bukan hardcode.
3. **Kontrak dulu** — OpenAPI 3.1 adalah sumber kebenaran; tipe client & server digenerate darinya.
4. **Modular monolith** — satu deployable, batas modul tegas; siap dipecah bila perlu.
5. **Secure by default** — deny-all RBAC, tenant isolation wajib di setiap query.

## 2. Tumpukan Teknologi
| Lapisan | Pilihan | Alasan |
|---|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Recharts | SSR untuk SEO landing, form kompleks |
| State form | react-hook-form + zod | Validasi selaras dengan schema API |
| Backend | **Elysia (Bun 1.2+, TypeScript)** | Throughput tinggi, `t.Object` schema-first yang langsung menghasilkan OpenAPI, tipe end-to-end via Eden |
| DB | PostgreSQL 16 | Relasional + JSONB untuk snapshot |
| ORM | Drizzle ORM | Native Bun, tipe-aman, migrasi SQL eksplisit |
| Cache/Queue | Redis + BullMQ (kompatibel Bun) | OTP, rate limit, job PDF & email |
| Object storage | S3-compatible (Cloudflare R2) | PDF & bukti |
| PDF | Playwright (render halaman hasil) | Konten identik HTML (PA3) |
| Auth | JWT access 15m + refresh rotatif 30d, Google OAuth2 | |
| QR code | `qrcode` (Bun/Node) untuk PNG & SVG | Dibuat server-side agar auditor bisa unduh dan cetak |
| Email | Resend / AWS SES | OTP, laporan |
| Observability | OpenTelemetry, Sentry, Grafana/Loki | |
| CI/CD | GitHub Actions → Docker → Fly.io/AWS ECS | |

## 3. Diagram Sistem
```mermaid
flowchart TB
  subgraph Client
    W[Next.js Web App]
  end
  subgraph Edge
    CDN[CDN / WAF / Rate limit]
  end
  subgraph API[Elysia Modular Monolith on Bun]
    AUTH[auth] --- ORG[organization]
    ORG --- ASM[assessment]
    ASM --- SCR[scoring engine]
    SCR --- REC[recommendation engine]
    REC --- RPT[report]
    RPT --- BMK[benchmark]
    ADM[admin cms] --- ASM
    INV[invitation & qr]
  end
  subgraph Async[Workers BullMQ]
    PDFW[pdf worker]
    MAILW[email worker]
    BMKW[benchmark refresh cron]
  end
  DB[(PostgreSQL)]
  RDS[(Redis)]
  S3[(Object Storage)]

  W --> CDN --> API
  API --> DB
  API --> RDS
  API --> Async
  PDFW --> S3
  BMKW --> DB
```

## 4. Model Data
```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : has
  ORGANIZATION ||--o{ MEMBERSHIP : has
  ORGANIZATION ||--o{ ASSESSMENT : owns
  ASSESSMENT ||--o{ ANSWER : contains
  ASSESSMENT ||--|| SCORE_RESULT : produces
  SCORE_RESULT ||--o{ DIMENSION_SCORE : breaks_into
  SCORE_RESULT ||--o{ RECOMMENDATION_ITEM : yields
  QUESTIONNAIRE_VERSION ||--o{ QUESTION : contains
  QUESTION ||--o{ QUESTION_OPTION : has
  DIMENSION ||--o{ QUESTION : groups
  ASSESSMENT ||--o{ SHARE_LINK : exposes
  ORGANIZATION ||--o{ ENTITLEMENT : holds
```

Tabel inti (kolom kunci):
- `companies(id, name, industry, employee_band, revenue_band, country, province, created_at)`
- `users(id, email, name, email_verified_at, created_at)`
- `memberships(user_id, company_id, role, status)` — PK gabungan
- `questionnaire_versions(id, version, status[DRAFT|PUBLISHED|ARCHIVED], published_at)`
- `dimensions(code, name, weight, questionnaire_version_id)`
- `questions(id, code, dimension_code, type, prompt, help_text, weight, required, order, visibility_rule JSONB, questionnaire_version_id)`
- `question_options(id, question_id, code, label, score, order)`
- `assessments(id, company_id, created_by, type[QUICK|FULL], status[IN_PROGRESS|SUBMITTED|SCORED|ARCHIVED], questionnaire_version_id, rubric_version, is_test, started_at, submitted_at, deleted_at)`
- `answers(id, assessment_id, question_code, value JSONB, evidence_url, answered_at)` — unique `(assessment_id, question_code)`
- `score_results(id, assessment_id, total_score, level, verdict, gates JSONB, confidence, breakdown JSONB, rubric_version, computed_at)`
- `dimension_scores(score_result_id, dimension_code, score, level, weight)`
- `recommendation_catalog(code, title, body, dimension_code, impact, effort, horizon, owner_role, cost_band, trigger_rule JSONB)`
- `recommendation_items(score_result_id, code, priority_score, rank)`
- `benchmarks(industry, employee_band, dimension_code, p25, p50, p75, sample_size, period)`
- `share_links(token_hash, assessment_id, expires_at, anonymize, revoked_at)`
- `invitations(id, company_id, assessment_id, token_hash, status, recipient_name, recipient_email, issued_at, opened_at, submitted_at, expires_at, revoked_at, reminder_count)` — unique index pada `token_hash`
- `audit_logs(id, actor_id, org_id, action, entity, entity_id, meta JSONB, ip, created_at)`

Indeks penting: `answers(assessment_id)`, `assessments(company_id, status)`, `score_results(assessment_id)`, `benchmarks(industry, employee_band)`.

## 5. Mesin Skoring
- Paket terpisah `packages/scoring` tanpa dependensi I/O → mudah diuji.
- Antarmuka: `score(input: ScoringInput): ScoringOutput` di mana `ScoringInput = { answers, questionnaire, rubric }`.
- **Wajib**: property-based test bahwa fungsi deterministik dan monotonic (menaikkan satu jawaban tidak menurunkan skor dimensi).
- Snapshot hasil disimpan ke `score_results.breakdown` agar laporan lama tetap dapat direproduksi.

Aturan visibilitas (JSON DSL):
```json
{
  "all": [
    { "question": "ORG-02", "op": "in", "value": ["50_99", "100_499", "500_999", "1000_plus"] },
    { "any": [ { "question": "TEC-01", "op": "eq", "value": "cloud_hybrid" } ] }
  ]
}
```
Operator didukung: `eq, neq, in, nin, gt, gte, lt, lte, exists`. Evaluator murni, tanpa eval dinamis.

## 6. Keamanan
| Area | Kontrol |
|---|---|
| Transport | TLS 1.3 wajib, HSTS |
| At rest | Enkripsi disk DB, bucket privat, pre-signed URL |
| AuthZ | Elysia `macro` guard per-route + filter `company_id` wajib di repository layer (tenant isolation ganda) |
| Rate limit | Plugin `elysia-rate-limit`: 100 req/menit/IP umum; 5 req/menit untuk OTP |
| Input | Validasi TypeBox (`t.Object`) di tiap handler, sanitasi teks, ukuran upload maks 10 MB, whitelist MIME |
| Secrets | Secret manager, tidak pernah di repo |
| Audit | Semua aksi mutasi tercatat di `audit_logs` |
| Token undangan | Acak ≥ 32 byte dari CSPRNG, disimpan sebagai hash (argon2id/SHA-256 + pepper), dibandingkan constant-time, punya masa berlaku dan dapat dicabut |
| Halaman form publik | Header `X-Robots-Tag: noindex, nofollow`; rate limit 30 req/menit per token; pesan 404 netral agar keberadaan token tidak bocor |
| PDP (UU 27/2022) | Consent tercatat, hak akses/hapus data, retensi draft 30 hari, data residency Indonesia/Singapura |
| Dependency | `bun audit` + Dependabot di CI, gagal build pada high severity |

## 7. Kinerja & Skala
| Metode | Target |
|---|---|
| p95 GET pertanyaan | < 300 ms |
| p95 PATCH autosave | < 150 ms (target diperketat dari 200 ms karena throughput Bun/Elysia) |
| Skoring sinkron | < 2 s |
| Generasi PDF | < 10 s (async, notifikasi) |
| Ketersediaan | 99.5% bulanan |
| Kapasitas awal | 500 assessment bersamaan, 50k baris jawaban/hari |

## 8. Pengujian
| Level | Cakupan | Alat |
|---|---|---|
| Unit | scoring, visibility DSL, recommendation rules (≥ 90% coverage paket scoring) | `bun test` |
| Kontrak | Respons API divalidasi terhadap OpenAPI yang digenerate `@elysiajs/openapi` (menghasilkan 3.1.x, selaras dengan `contracts/openapi.yaml`) | schemathesis |
| Integrasi | Repository + Postgres nyata | Testcontainers |
| E2E | Alur daftar → isi → submit → laporan → PDF | Playwright |
| Beban | 200 VU pada endpoint autosave | k6 |
| Aksesibilitas | WCAG 2.1 AA pada form | axe-core di CI |

## 9. Lingkungan & Rilis
`local` → `staging` (data sintetis) → `production`. Migrasi Drizzle (`drizzle-kit`) dijalankan otomatis dengan strategi expand-and-contract. Feature flag untuk F10/F14/F17. Rollback: image sebelumnya + migrasi backward-compatible.

## 10. Observability
- Trace terhubung dari klik submit sampai skoring (`trace_id` dikembalikan di error envelope).
- Metrik bisnis di-emit sebagai metrik: `assessment_submitted_total`, `dropoff_by_question`, `scoring_duration_seconds`.
- Alert: error rate > 2% 5 menit, p95 autosave > 500 ms, antrean PDF > 100.

## 11. Backup & DR
Backup Postgres PITR harian + WAL; uji restore bulanan. RPO 15 menit, RTO 4 jam.

## 12. Struktur Repo
```
audit/
  apps/web        Next.js
  apps/api        Elysia (Bun) — modul: auth, company, invitation, respondent, report, admin
  packages/scoring    mesin skoring murni (dapat diimpor web & api)
  packages/contracts  tipe hasil generate dari OpenAPI + Eden Treaty client
  contracts/openapi.yaml
  docs/           BRD, PRD, FRD, TRD, DESIGN, QUESTION_BANK
  drizzle/        schema & migrasi SQL
  tools/          validate_docs.py
```

## 13. Catatan Khusus Elysia

**Struktur modul** — tiap domain adalah instance Elysia terpisah yang dikomposisi di root, menggantikan peran NestJS module:
```ts
import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'

const assessment = new Elysia({ prefix: '/assessments' })
  .use(authGuard)          // menyuntikkan { user, orgId } ke context
  .use(orgScope)           // memvalidasi X-Org-Id & keanggotaan
  .patch('/:id/answers', handler, {
    params: t.Object({ id: t.String({ format: 'uuid' }) }),
    body: AnswerBatchSchema,
    response: { 200: SaveResultSchema, 422: ErrorEnvelopeSchema },
  })

new Elysia().use(openapi()).use(auth).use(assessment).listen(3001)
```

> Terverifikasi pada spike Elysia 1.4.30 (`tools/spike-elysia/`): pola guard, tenant isolation, validasi TypeBox, dan pemetaan error berjalan; 12 uji perilaku lulus.

**Pilihan plugin dokumentasi** — gunakan `@elysiajs/openapi`, bukan `@elysiajs/swagger`. Diuji langsung: `@elysiajs/swagger@1.3.1` memancarkan `openapi: 3.0.3`, sedangkan `@elysiajs/openapi` memancarkan `3.1.2` sehingga selaras dengan `contracts/openapi.yaml` dan uji kontrak tidak gagal karena beda versi spec.

**Skema sebagai sumber kebenaran ganda** — TypeBox (`t.Object`) mendefinisikan validasi runtime sekaligus menghasilkan dokumen OpenAPI. `contracts/openapi.yaml` tetap menjadi kontrak yang disepakati; CI membandingkan spec yang digenerate Elysia dengan file tersebut dan gagal bila terjadi drift (lihat §8 uji kontrak).

**Dependency injection** — memakai `.decorate()` dan `.derive()` alih-alih container DI. Repository disuntikkan sebagai dependensi eksplisit agar mesin skoring tetap murni dan mudah diuji.

**Penanganan error** — satu `.onError()` global memetakan `code === 'VALIDATION'` ke amplop `ErrorEnvelope` (FRD §11) sehingga bentuk error konsisten di semua modul. Terverifikasi: body yang melanggar `t.Object` menghasilkan 422 dengan `error.code = INVALID_ANSWER_TYPE`.

**Catatan pengujian** — saat menguji lewat `app.handle(new Request(url))`, gunakan hostname yang valid seperti `http://localhost/...`. Hostname satu-label seperti `http://x/...` menyebabkan route tidak ter-match dan mengembalikan 404 palsu. Temuan ini ditemukan saat spike.

**Tipe end-to-end** — frontend memakai Eden Treaty sehingga perubahan handler langsung terdeteksi sebagai type error di `apps/web`, tanpa codegen manual.

**Konsekuensi yang diterima** — ekosistem Elysia lebih muda dari NestJS; pustaka yang belum matang di Bun (mis. SDK pembayaran) diisolasi di balik antarmuka adapter agar mudah diganti.
