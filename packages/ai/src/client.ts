/**
 * Klien chat completion untuk 9router (kompatibel OpenAI).
 *
 * Sengaja tipis dan tanpa SDK: satu endpoint POST /chat/completions sudah cukup,
 * dan `fetch` disuntikkan agar uji dapat berjalan tanpa jaringan.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Disuntikkan untuk uji; default memakai fetch global. */
  fetchImpl?: typeof fetch
  /** Batas waktu satu panggilan; menjaga UI tidak menggantung. */
  timeoutMs?: number
}

export interface ChatClient {
  complete(messages: ChatMessage[], opts?: { json?: boolean }): Promise<string>
  model: string
}

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AiError'
  }
}

/**
 * Konfigurasi dari environment.
 * Mengembalikan null bila kunci belum diisi, sehingga aplikasi dapat melapor
 * "AI belum dikonfigurasi" secara jujur alih-alih gagal saat dipakai.
 */
export function aiConfigFromEnv(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const apiKey = env.AI_API_KEY
  if (!apiKey) return null
  return {
    baseUrl: env.AI_BASE_URL ?? 'https://9router.aipreneur.co.id/v1',
    apiKey,
    model: env.AI_MODEL ?? 'ag/gemini-3.8-flash-medium',
  }
}

export function createChatClient(cfg: AiConfig): ChatClient {
  const doFetch = cfg.fetchImpl ?? fetch
  const timeoutMs = cfg.timeoutMs ?? 60_000
  return {
    model: cfg.model,
    async complete(messages, opts = {}) {
      const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          // Non-stream: pemanggil butuh satu hasil utuh, bukan potongan.
          stream: false,
          messages,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        throw new AiError(`Model menolak permintaan (${res.status})`, res.status)
      }
      const data = await res.json() as {
        choices?: { message?: { content?: string } }[]
      }
      const text = data.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.trim() === '') {
        throw new AiError('Model tidak mengembalikan isi jawaban')
      }
      return text
    },
  }
}

/**
 * Mengambil objek JSON dari balasan model.
 *
 * Model kerap membungkus JSON dalam pagar kode markdown; membuang pagar itu di
 * satu tempat lebih murah daripada menuntut kepatuhan sempurna dari model.
 */
export function parseJsonReply<T>(text: string): T {
  const bersih = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  const mulai = bersih.indexOf('{')
  const akhir = bersih.lastIndexOf('}')
  if (mulai === -1 || akhir <= mulai) throw new AiError('Balasan model bukan JSON')
  try {
    return JSON.parse(bersih.slice(mulai, akhir + 1)) as T
  } catch {
    throw new AiError('Balasan model bukan JSON yang sah')
  }
}
