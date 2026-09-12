/**
 * Server web responden (PRD §9, DESIGN B3/B4).
 *
 * Berbicara ke API lewat HTTP sehingga batas modul tetap tegas dan aturan
 * bisnis tidak terduplikasi di sini. Semua keputusan (visibilitas, validasi,
 * skoring) tetap milik API.
 */
import { Elysia, t } from 'elysia'
import { QUESTIONNAIRE_V1, type Question } from '@siapai/scoring'

/**
 * Dimensi pemilik sebuah pertanyaan.
 * Tidak boleh diambil dari awalan kode: ORG-02 misalnya berkode "ORG" tetapi
 * berada di dimensi STR. Memotong string akan menghasilkan seksi yang tidak ada.
 */
function dimensionOf(code: string): string | undefined {
  return QUESTIONNAIRE_V1.questions.find((q) => q.code === code)?.dimension_code
}
import { invalidPage, questionPage, resultPage, reviewPage, submittedPage, welcomePage } from './views'

export interface WebDeps {
  /** Pemanggil API; diinjeksi agar uji dapat memakai app API langsung. */
  api: (path: string, init?: RequestInit) => Promise<Response>
}

interface SectionPayload {
  dimension: { code: string; name: string }
  section_index: number
  section_total: number
  questions: Question[]
  answers: { question_code: string; value: unknown }[]
  progress: { answered: number; total_visible: number; percent: number; estimated_minutes_left: number }
}

/** Mengubah nilai form HTML menjadi AnswerValue sesuai tipe pertanyaan. */
export function toAnswerValue(type: string, raw: string[]): unknown | null {
  const first = raw[0]
  switch (type) {
    case 'single_choice':
      return first ? { choice: first } : null
    case 'multi_choice':
      return { choices: raw }
    case 'scale_1_5': {
      const n = Number(first)
      return Number.isInteger(n) && n >= 1 && n <= 5 ? { scale: n } : null
    }
    case 'boolean':
      return first === 'true' ? { bool: true } : first === 'false' ? { bool: false } : null
    case 'number': {
      const n = Number(first)
      return Number.isFinite(n) ? { number: n } : null
    }
    default:
      return null
  }
}

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // FR-25 AC5: halaman form tidak boleh terindeks.
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store',
      ...extra,
    },
  })

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } })

export function createWeb({ api }: WebDeps) {
  /** Mengambil seksi berjalan; null berarti token tidak berlaku. */
  async function section(token: string, dim?: string): Promise<SectionPayload | null> {
    const res = await api(`/f/${token}/next${dim ? `?section=${dim}` : ''}`)
    return res.ok ? ((await res.json()) as SectionPayload) : null
  }

  /** Pertanyaan berikut yang belum dijawab di seksi ini, atau null bila tuntas. */
  function firstUnanswered(s: SectionPayload) {
    const answered = new Set(s.answers.map((a) => a.question_code))
    return s.questions.find((q) => !answered.has(q.code)) ?? null
  }

  // Rute akar tidak didefinisikan di sini: modul ini hanya melayani jalur
  // bertoken (/f dan /l). Halaman depan menjadi urusan komposisi aplikasi.
  return new Elysia()
    // ── Sambutan
    .get('/f/:token', async ({ params }) => {
      const res = await api(`/f/${params.token}`)
      if (!res.ok) return html(invalidPage(), 404)
      const d = await res.json()
      return html(welcomePage({ token: params.token, ...d }))
    }, { params: t.Object({ token: t.String() }) })

    // ── Satu pertanyaan per layar
    .get('/f/:token/isi', async ({ params, query }) => {
      const target = query.q ? dimensionOf(query.q) : undefined
      const s = await section(params.token, target)
      if (!s) return html(invalidPage(), 404)

      const answers = new Map(s.answers.map((a) => [a.question_code, a.value]))
      // Bila pengguna melompat dari halaman review, tampilkan pertanyaan itu.
      const q = query.q
        ? s.questions.find((x) => x.code === query.q) ?? firstUnanswered(s)
        : firstUnanswered(s)

      // Seksi tuntas: lanjut ke seksi berikutnya, atau ke review bila semua selesai.
      if (!q) {
        if (s.progress.answered >= s.progress.total_visible) {
          return redirect(`/f/${params.token}/periksa`)
        }
        const next = await section(params.token)
        if (!next) return html(invalidPage(), 404)
        const nq = firstUnanswered(next)
        if (!nq) return redirect(`/f/${params.token}/periksa`)
        return html(renderQuestion(params.token, next, nq, answers))
      }
      return html(renderQuestion(params.token, s, q, answers))
    }, {
      params: t.Object({ token: t.String() }),
      query: t.Object({ q: t.Optional(t.String()) }),
    })

    // ── Simpan satu jawaban lalu lanjut (bekerja tanpa JavaScript)
    .post('/f/:token/isi', async ({ params, body, request }) => {
      const form = body as Record<string, string | string[]>
      const code = String(form.question_code ?? '')
      const type = String(form.type ?? '')
      const raw = Array.isArray(form.value) ? form.value : form.value ? [String(form.value)] : []
      const value = toAnswerValue(type, raw)
      if (!code || value === null) {
        // Tidak memilih apa pun bukan error; kembalikan ke pertanyaan yang sama.
        return request.headers.get('x-async')
          ? new Response('{"ok":false}', { status: 422 })
          : redirect(`/f/${params.token}/isi?q=${code}`)
      }

      const res = await api(`/f/${params.token}/answers`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ question_code: code, value }] }),
      })
      // Permintaan autosave dari JS tidak butuh halaman, cukup status.
      if (request.headers.get('x-async')) {
        return new Response(res.ok ? '{"ok":true}' : '{"ok":false}',
          { status: res.status, headers: { 'content-type': 'application/json' } })
      }
      if (!res.ok) return html(invalidPage(), 404)
      return redirect(`/f/${params.token}/isi`)
    }, { params: t.Object({ token: t.String() }) })

    // ── Review
    .get('/f/:token/periksa', async ({ params }) => {
      const res = await api(`/f/${params.token}/review`)
      if (!res.ok) return html(invalidPage(), 404)
      const d = await res.json() as {
        progress: SectionPayload['progress']; missing: string[]
      }
      // Ambil teks pertanyaan agar daftar yang kurang dapat dipahami manusia,
      // bukan sekadar deretan kode seperti "DAT-03".
      const prompts = new Map<string, string>()
      const dims = new Set(
        d.missing.map((m) => dimensionOf(m)).filter((x): x is string => x !== undefined),
      )
      for (const dim of dims) {
        const s = await section(params.token, dim)
        s?.questions.forEach((q) => prompts.set(q.code, q.prompt))
      }
      return html(reviewPage({
        token: params.token,
        progress: d.progress,
        missing: d.missing.map((code) => ({ code, prompt: prompts.get(code) ?? code })),
      }))
    }, { params: t.Object({ token: t.String() }) })

    // ── Kirim
    .post('/f/:token/kirim', async ({ params }) => {
      const res = await api(`/f/${params.token}/submit`, { method: 'POST' })
      if (res.status === 422) return redirect(`/f/${params.token}/periksa`)
      if (!res.ok && res.status !== 409) return html(invalidPage(), 404)
      return html(submittedPage(params.token))
    }, { params: t.Object({ token: t.String() }) })

    // ── FR-18 laporan yang dibagikan, dibuka tanpa akun
    .get('/l/:token', async ({ params }) => {
      const res = await api(`/l/${params.token}`)
      if (!res.ok) return html(invalidPage(), 404)
      const d = await res.json() as {
        company_name: string | null
        result: Parameters<typeof resultPage>[0]['result']
        recommendations: Parameters<typeof resultPage>[0]['recommendations']
      }
      return html(resultPage({
        // Nama disembunyikan bila tautan dibuat dengan opsi anonymize.
        company_name: d.company_name ?? 'Perusahaan (dirahasiakan)',
        result: d.result,
        recommendations: d.recommendations,
      }))
    }, { params: t.Object({ token: t.String() }) })

    // ── Hasil
    .get('/f/:token/hasil', async ({ params }) => {
      const res = await api(`/f/${params.token}/result`)
      if (res.status === 409) return redirect(`/f/${params.token}/periksa`)
      if (!res.ok) return html(invalidPage(), 404)
      const d = await res.json()
      const welcome = await (await api(`/f/${params.token}`)).json()
      return html(resultPage({
        company_name: welcome.company_name,
        result: d.result,
        recommendations: d.recommendations,
      }))
    }, { params: t.Object({ token: t.String() }) })
}

function renderQuestion(
  token: string,
  s: SectionPayload,
  q: Question,
  answers: Map<string, unknown>,
): string {
  const idx = s.questions.findIndex((x) => x.code === q.code)
  const value = answers.get(q.code)
  return questionPage({
    token,
    question: q,
    index: idx + 1,
    total: s.questions.length,
    dimensionName: s.dimension.name,
    sectionIndex: s.section_index,
    sectionTotal: s.section_total,
    ...(value !== undefined ? { value } : {}),
    progress: s.progress,
  })
}
