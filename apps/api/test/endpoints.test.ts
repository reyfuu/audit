import '../test/setup-dev-tokens'
/**
 * Menegakkan kejujuran penandaan `x-status` di kontrak.
 *
 * Pemeriksaan statis di tools/traceability.py hanya mencari penanda route di
 * kode. Di sini setiap path bertanda `implemented` benar-benar dipanggil, dan
 * harus membalas apa pun KECUALI 404 tingkat route. Dengan begitu, menandai
 * endpoint yang belum ada akan langsung ketahuan.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createApp } from '../src/app'
import { createMemoryRepo } from '../src/lib/repo'

const BASE = 'http://localhost:3001'
const spec = readFileSync(new URL('../../../contracts/openapi.yaml', import.meta.url), 'utf8')

/** Path beserta status implementasinya, dibaca langsung dari kontrak. */
function pathsBerstatus(status: string): string[] {
  const out: string[] = []
  const baris = spec.split('\n')
  for (let i = 0; i < baris.length; i++) {
    const m = /^ {2}(\/[^\s:]+):\s*$/.exec(baris[i]!)
    if (m && baris[i + 1]?.includes(`x-status: ${status}`)) out.push(m[1]!)
  }
  return out
}

/** Mengisi placeholder path dengan nilai yang bentuknya sah. */
function isiParam(p: string): string {
  return p
    .replace('{assessmentId}', crypto.randomUUID())
    .replace('{invitationId}', crypto.randomUUID())
    .replace('{companyId}', crypto.randomUUID())
    .replace('{shareId}', crypto.randomUUID())
    .replace('{token}', 'x'.repeat(43))
}

/** Metode HTTP yang terdaftar untuk sebuah path di kontrak. */
function metodeUntuk(p: string): string[] {
  const idx = spec.indexOf(`\n  ${p}:\n`)
  if (idx < 0) return []
  const blok = spec.slice(idx + 1).split(/\n {2}\/[^\s:]+:/)[0] ?? ''
  return [...blok.matchAll(/^ {4}(get|post|patch|put|delete):/gm)].map((m) => m[1]!)
}

describe('kejujuran x-status pada kontrak', () => {
  const implemented = pathsBerstatus('implemented')

  it('kontrak memuat sejumlah path bertanda implemented', () => {
    expect(implemented.length).toBeGreaterThan(15)
  })

  it('setiap path implemented punya handler yang merespons, bukan 404 route', async () => {
    const repo = createMemoryRepo()
    const auditor = await repo.createAuditor({ email: 'e@x.id', name: 'D', role: 'auditor_admin' })
    const { app } = createApp({ repo, baseUrl: BASE })
    const gagal: string[] = []

    for (const p of implemented) {
      for (const m of metodeUntuk(p)) {
        const url = `${BASE}${isiParam(p)}`
        const res = await app.handle(new Request(url, {
          method: m.toUpperCase(),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer user:${auditor.id}`,
          },
          ...(m === 'get' || m === 'delete' ? {} : { body: '{}' }),
        }))
        // Handler yang ada akan memvalidasi masukan lebih dulu, sehingga
        // membalas 401/403/409/422, atau 404 dengan pesan spesifik domain.
        // Route yang tidak ada selalu jatuh ke onError global dengan pesan
        // generik "Tidak ditemukan".
        if (res.status === 404) {
          const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
          if (body.error?.message === 'Tidak ditemukan') {
            gagal.push(`${m.toUpperCase()} ${p} → tidak ada handler`)
          }
        }
      }
    }
    expect(gagal).toEqual([])
  })

  it('path bertanda planned memang belum punya handler', async () => {
    const repo = createMemoryRepo()
    const auditor = await repo.createAuditor({ email: 'f@x.id', name: 'D', role: 'auditor' })
    const { app } = createApp({ repo, baseUrl: BASE })
    const planned = pathsBerstatus('planned')
    const terlanjurAda: string[] = []

    for (const p of planned) {
      for (const m of metodeUntuk(p)) {
        const res = await app.handle(new Request(`${BASE}${isiParam(p)}`, {
          method: m.toUpperCase(),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer user:${auditor.id}`,
          },
          ...(m === 'get' || m === 'delete' ? {} : { body: '{}' }),
        }))
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
        // Route yang belum ada jatuh ke onError global dengan pesan generik.
        // Apa pun selain itu berarti handlernya sudah ada dan penandaan
        // `planned` di kontrak sudah usang.
        const belumAda = res.status === 404 && body.error?.message === 'Tidak ditemukan'
        if (!belumAda) terlanjurAda.push(`${m.toUpperCase()} ${p} → ${res.status}`)
      }
    }
    expect(terlanjurAda).toEqual([])
  })
})
