# Spike Elysia

Bukti bahwa pola arsitektur di `docs/TRD.md` §13 benar-benar jalan di Elysia 1.4,
bukan pseudocode. Bukan kode produksi.

## Jalankan
```bash
cd tools/spike-elysia && bun install && bun test
bun openapi-version-check.ts   # membuktikan @elysiajs/openapi memancarkan 3.1.x
```

## Yang dibuktikan
| Requirement | Uji |
|---|---|
| FR-09 AC1 autosave batch + server_revision | `menyimpan batch...` |
| FR-09 AC1 idempoten per question_code | `idempoten...` |
| FR-09 AC3 tolak pertanyaan tidak visible | `422 QUESTION_NOT_VISIBLE` |
| FR-09 AC4 validasi tipe nilai | `422 INVALID_ANSWER_TYPE` |
| FR-09 batas batch 1..50 | `minItems` / `maxItems` |
| FR-12 AC3 SCORED read-only | `409 CONFLICT` |
| TRD §6 auth guard | `401 UNAUTHENTICATED` |
| TRD §6 X-Org-Id wajib | `403 FORBIDDEN` |
| TRD §6 tenant isolation | org lain dapat `404`, bukan `403` |
| FRD §11 amplop error seragam | semua error bertipe `{ error: { code, message } }` |

## Temuan yang mengubah TRD
1. `@elysiajs/swagger@1.3.1` memancarkan OpenAPI **3.0.3**; `@elysiajs/openapi` memancarkan **3.1.2**. TRD diubah ke yang kedua agar selaras dengan `contracts/openapi.yaml`.
2. `app.handle(new Request('http://x/...'))` gagal match route (404 palsu) karena hostname satu-label. Gunakan `http://localhost/...` di test.
