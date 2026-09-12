/**
 * Uji klien dan tinjauan AI.
 *
 * Tanpa jaringan: `fetch` disuntikkan. Yang diuji adalah hal yang benar-benar
 * bisa salah — bentuk permintaan ke 9router, dan ketahanan terhadap balasan
 * model yang tidak rapi.
 */
import { describe, it, expect } from 'bun:test'
import {
  AiError, aiConfigFromEnv, buildReviewPrompt, createChatClient,
  normalizeReview, parseJsonReply, reviewAnswers,
} from '../src/index'

const balasan = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }),
    { headers: { 'content-type': 'application/json' } })

const INPUT = {
  company: { name: 'PT Coba', industry: 'retail_ecommerce', employee_band: '50_99' },
  score: { total_score: 42, verdict: 'NOT_READY', level: 2 },
  dimensions: [{ dimension_code: 'DAT', name: 'Data', score: 20 }],
  answers: [{ question_code: 'DAT-01', prompt: 'Di mana data disimpan?', answer: 'Spreadsheet' }],
}

describe('klien chat 9router', () => {
  it('mengirim model, kunci, dan pesan ke endpoint chat/completions', async () => {
    let permintaan: { url: string; init: RequestInit } | null = null
    const client = createChatClient({
      baseUrl: 'https://9router.example/v1/',
      apiKey: 'sk-rahasia',
      model: 'ag/gemini-3.8-flash-medium',
      fetchImpl: (async (url: string, init: RequestInit) => {
        permintaan = { url, init }
        return balasan('halo')
      }) as unknown as typeof fetch,
    })

    expect(await client.complete([{ role: 'user', content: 'hai' }], { json: true })).toBe('halo')
    const p = permintaan! as { url: string; init: RequestInit }
    expect(p.url).toBe('https://9router.example/v1/chat/completions')
    expect((p.init.headers as Record<string, string>).authorization).toBe('Bearer sk-rahasia')
    const body = JSON.parse(String(p.init.body))
    expect(body.model).toBe('ag/gemini-3.8-flash-medium')
    expect(body.stream).toBe(false)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('melaporkan error yang jelas saat model menolak', async () => {
    const client = createChatClient({
      baseUrl: 'https://x/v1', apiKey: 'k', model: 'm',
      fetchImpl: (async () => new Response('no', { status: 429 })) as unknown as typeof fetch,
    })
    expect(client.complete([{ role: 'user', content: 'a' }])).rejects.toThrow(AiError)
  })

  it('menolak balasan kosong alih-alih meneruskan string kosong', async () => {
    const client = createChatClient({
      baseUrl: 'https://x/v1', apiKey: 'k', model: 'm',
      fetchImpl: (async () => balasan('   ')) as unknown as typeof fetch,
    })
    expect(client.complete([{ role: 'user', content: 'a' }])).rejects.toThrow(AiError)
  })
})

describe('konfigurasi dari environment', () => {
  it('null bila kunci belum diisi, agar aplikasi dapat melapor jujur', () => {
    expect(aiConfigFromEnv({})).toBeNull()
  })

  it('memakai default 9router bila hanya kunci yang diberikan', () => {
    const cfg = aiConfigFromEnv({ AI_API_KEY: 'sk-1' })!
    expect(cfg.baseUrl).toBe('https://9router.aipreneur.co.id/v1')
    expect(cfg.model).toBe('ag/gemini-3.8-flash-medium')
  })
})

describe('parsing balasan', () => {
  it('membuang pagar kode markdown yang sering ditambahkan model', () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('mengabaikan basa-basi di sekitar JSON', () => {
    expect(parseJsonReply<{ a: number }>('Berikut hasilnya:\n{"a":2}\nsemoga membantu')).toEqual({ a: 2 })
  })

  it('menolak balasan yang bukan JSON', () => {
    expect(() => parseJsonReply('maaf saya tidak bisa')).toThrow(AiError)
  })
})

describe('normalisasi tinjauan', () => {
  it('menjepit data_quality ke 0..100 dan membatasi jumlah flag', () => {
    const r = normalizeReview({
      data_quality: 500,
      summary: 'ringkas',
      flags: Array.from({ length: 10 }, (_, i) => ({
        question_codes: ['DAT-01'], severity: 'high', issue: `x${i}`, follow_up: 'y',
      })),
      next_checks: ['a', 'b', 'c', 'd', 'e'],
    }, 'm', '2026-01-01T00:00:00.000Z')
    expect(r.data_quality).toBe(100)
    expect(r.flags).toHaveLength(6)
    expect(r.next_checks).toHaveLength(4)
  })

  it('memberi nilai aman saat model mengembalikan bentuk asing', () => {
    const r = normalizeReview({ data_quality: 'entah', flags: 'bukan array' }, 'm', 'now')
    expect(r.data_quality).toBe(50)
    expect(r.flags).toEqual([])
    expect(r.summary).toContain('tidak menghasilkan')
  })

  it('menurunkan severity tak dikenal menjadi low, bukan melempar', () => {
    const r = normalizeReview({
      data_quality: 70, summary: 's',
      flags: [{ severity: 'KIAMAT', issue: 'aneh' }],
    }, 'm', 'now')
    expect(r.flags[0]!.severity).toBe('low')
  })
})

describe('reviewAnswers', () => {
  it('menyertakan kode pertanyaan dan skor dimensi ke dalam prompt', () => {
    const p = buildReviewPrompt(INPUT)
    expect(p).toContain('DAT-01')
    expect(p).toContain('Spreadsheet')
    expect(p).toContain('42/100')
  })

  it('menghasilkan tinjauan ternormalisasi dari balasan model', async () => {
    const client = createChatClient({
      baseUrl: 'https://x/v1', apiKey: 'k', model: 'ag/gemini-3.8-flash-medium',
      fetchImpl: (async () => balasan(JSON.stringify({
        data_quality: 65, summary: 'Data lemah.',
        flags: [{ question_codes: ['DAT-01'], severity: 'high', issue: 'Spreadsheet', follow_up: 'Siapa pemiliknya?' }],
        next_checks: ['Minta contoh file'],
      }))) as unknown as typeof fetch,
    })
    const r = await reviewAnswers(client, INPUT, () => new Date('2026-01-01T00:00:00.000Z'))
    expect(r.data_quality).toBe(65)
    expect(r.flags[0]!.severity).toBe('high')
    expect(r.model).toBe('ag/gemini-3.8-flash-medium')
    expect(r.reviewed_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('menolak meninjau assessment tanpa jawaban', async () => {
    const client = createChatClient({
      baseUrl: 'https://x/v1', apiKey: 'k', model: 'm',
      fetchImpl: (async () => balasan('{}')) as unknown as typeof fetch,
    })
    expect(reviewAnswers(client, { ...INPUT, answers: [] })).rejects.toThrow(AiError)
  })
})
