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

describe('FR-05 ubah dan hapus perusahaan', () => {
  /** Auditor dengan satu perusahaan miliknya. */
  async function skenario() {
    const repo = createMemoryRepo()
    const { app } = createApp({ repo, baseUrl: BASE })
    const a = await repo.createAuditor({ email: 'a@x.id', name: 'A', role: 'auditor' })
    const b = await repo.createAuditor({ email: 'b@x.id', name: 'B', role: 'auditor' })
    const c = await repo.createCompany({
      owner_auditor_id: a.id, name: 'PT Asli',
      industry: 'retail_ecommerce', employee_band: '50_99', country: 'ID',
    })
    const call = (path: string, init: RequestInit = {}, who = a.id) =>
      app.handle(new Request(`${BASE}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer user:${who}`,
          ...(init.headers ?? {}),
        },
      }))
    return { app, repo, a, b, c, call }
  }

  it('PATCH mengubah sebagian field tanpa menyentuh sisanya', async () => {
    const s = await skenario()
    const res = await s.call(`/companies/${s.c.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'PT Berubah' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('PT Berubah')
    // Field yang tidak dikirim tetap seperti semula.
    expect(body.industry).toBe('retail_ecommerce')
    expect(body.employee_band).toBe('50_99')
    expect(body.id).toBe(s.c.id)
  })

  it('PATCH tidak dapat memindahkan kepemilikan', async () => {
    const s = await skenario()
    await s.call(`/companies/${s.c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'PT Coba', owner_auditor_id: s.b.id }),
    })
    // Perusahaan tetap milik auditor semula.
    expect(await s.repo.getCompany(s.c.id, s.a.id)).toBeDefined()
    expect(await s.repo.getCompany(s.c.id, s.b.id)).toBeUndefined()
  })

  it('auditor lain mendapat 404, bukan 403, agar keberadaannya tidak bocor', async () => {
    const s = await skenario()
    const ubah = await s.call(`/companies/${s.c.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'PT Dibajak' }),
    }, s.b.id)
    expect(ubah.status).toBe(404)

    const hapus = await s.call(`/companies/${s.c.id}`, { method: 'DELETE' }, s.b.id)
    expect(hapus.status).toBe(404)

    // Datanya utuh.
    expect((await s.repo.getCompany(s.c.id, s.a.id))?.name).toBe('PT Asli')
  })

  it('DELETE menghapus perusahaan beserta assessment dan undangannya', async () => {
    const s = await skenario()
    const inv = await (await s.call('/invitations', {
      method: 'POST', body: JSON.stringify({ company_id: s.c.id }),
    })).json() as { id: string; assessment_id: string }

    expect((await s.call(`/companies/${s.c.id}`, { method: 'DELETE' })).status).toBe(204)

    expect(await s.repo.getCompany(s.c.id, s.a.id)).toBeUndefined()
    expect(await s.repo.getAssessment(inv.assessment_id)).toBeUndefined()
    expect(await s.repo.getInvitation(inv.id)).toBeUndefined()
    expect(await s.repo.listInvitations(s.a.id)).toHaveLength(0)
  })

  it('menghapus dua kali tidak menimbulkan galat internal', async () => {
    const s = await skenario()
    expect((await s.call(`/companies/${s.c.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await s.call(`/companies/${s.c.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('nama yang terlalu pendek ditolak validasi', async () => {
    const s = await skenario()
    const res = await s.call(`/companies/${s.c.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('FR-33 perbarui profil auditor', () => {
  it('email dinormalkan dan tetap dapat dipakai masuk', async () => {
    const repo = createMemoryRepo()
    const { app } = createApp({ repo, baseUrl: BASE })
    const a = await repo.createAuditor({ email: 'lama@x.id', name: 'Lama', role: 'auditor' })
    const res = await app.handle(new Request(`${BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer user:${a.id}` },
      body: JSON.stringify({ name: '  Nama Baru  ', email: 'BARU@X.ID' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Spasi dipangkas dan email dijadikan huruf kecil, supaya pencarian konsisten.
    expect(body.name).toBe('Nama Baru')
    expect(body.email).toBe('baru@x.id')
    expect(await repo.getAuditorByEmail('baru@x.id')).toBeDefined()
  })

  it('tidak dapat mengambil email milik auditor lain', async () => {
    const repo = createMemoryRepo()
    const { app } = createApp({ repo, baseUrl: BASE })
    const a = await repo.createAuditor({ email: 'a@x.id', name: 'A', role: 'auditor' })
    await repo.createAuditor({ email: 'b@x.id', name: 'B', role: 'auditor' })
    const res = await app.handle(new Request(`${BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer user:${a.id}` },
      body: JSON.stringify({ email: 'b@x.id' }),
    }))
    expect(res.status).toBe(409)
    expect((await repo.getAuditor(a.id))?.email).toBe('a@x.id')
  })

  it('peran tidak dapat dinaikkan lewat endpoint profil', async () => {
    const repo = createMemoryRepo()
    const { app } = createApp({ repo, baseUrl: BASE })
    const a = await repo.createAuditor({ email: 'a@x.id', name: 'A', role: 'auditor' })
    await app.handle(new Request(`${BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer user:${a.id}` },
      body: JSON.stringify({ name: 'A', role: 'sysadmin' }),
    }))
    expect((await repo.getAuditor(a.id))?.role).toBe('auditor')
  })

  it('tanpa autentikasi ditolak', async () => {
    const { app } = createApp({ baseUrl: BASE })
    const res = await app.handle(new Request(`${BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Siapa Saja' }),
    }))
    expect(res.status).toBe(401)
  })
})
