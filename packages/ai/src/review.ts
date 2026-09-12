/**
 * Tinjauan AI atas jawaban form (FR-31).
 *
 * Tujuannya bukan menggantikan skoring — skor tetap deterministik dari rubrik
 * (ADR-002) — melainkan menangkap hal yang tidak bisa dilihat aturan: jawaban
 * yang saling bertentangan, pola "semua sempurna" yang mencurigakan, dan
 * konteks yang perlu dikonfirmasi auditor sebelum laporan dikirim ke klien.
 *
 * Dengan ratusan perusahaan, auditor tidak sanggup membaca semua jawaban satu
 * per satu; tinjauan ini memberi urutan perhatian.
 */
import type { ChatClient } from './client'
import { AiError, parseJsonReply } from './client'

export type FlagSeverity = 'low' | 'medium' | 'high'

export interface ReviewFlag {
  /** Kode pertanyaan terkait; kosong bila temuan bersifat menyeluruh. */
  question_codes: string[]
  severity: FlagSeverity
  /** Apa yang janggal, dalam bahasa auditor. */
  issue: string
  /** Pertanyaan konfirmasi yang bisa langsung ditanyakan ke responden. */
  follow_up: string
}

export interface ReviewResult {
  /** 0..100: seberapa layak jawaban ini dipercaya apa adanya. */
  data_quality: number
  summary: string
  flags: ReviewFlag[]
  /** Hal yang paling perlu dicek auditor lebih dulu. */
  next_checks: string[]
  model: string
  reviewed_at: string
}

export interface ReviewInput {
  company: { name: string; industry: string; employee_band: string }
  score: { total_score: number; verdict: string; level: number }
  dimensions: { dimension_code: string; name: string; score: number }[]
  answers: { question_code: string; prompt: string; answer: string }[]
}

const SYSTEM = `Anda adalah auditor senior kesiapan AI untuk perusahaan Indonesia.
Tugas Anda meninjau jawaban kuesioner satu perusahaan dan menilai kualitas datanya,
bukan menghitung ulang skor.

Cari khususnya:
- jawaban yang saling bertentangan antar dimensi
- klaim tingkat kematangan tinggi tanpa fondasi pendukung
- pola jawaban seragam yang menandakan pengisian asal-asalan
- konteks penting yang belum tergali dan perlu dikonfirmasi auditor

Jawab HANYA dengan JSON dengan bentuk persis:
{
  "data_quality": <integer 0-100>,
  "summary": "<2-3 kalimat bahasa Indonesia>",
  "flags": [
    {
      "question_codes": ["KODE"],
      "severity": "low" | "medium" | "high",
      "issue": "<apa yang janggal>",
      "follow_up": "<pertanyaan konfirmasi untuk responden>"
    }
  ],
  "next_checks": ["<langkah verifikasi auditor>"]
}
Maksimal 6 flag, maksimal 4 next_checks. Bahasa Indonesia, ringkas, konkret.
Jangan mengarang fakta yang tidak ada di jawaban.`

export function buildReviewPrompt(input: ReviewInput): string {
  const dims = input.dimensions
    .map((d) => `- ${d.name} (${d.dimension_code}): ${d.score}/100`).join('\n')
  const jawaban = input.answers
    .map((a) => `[${a.question_code}] ${a.prompt}\n  -> ${a.answer}`).join('\n')
  return `PERUSAHAAN
Nama: ${input.company.name}
Industri: ${input.company.industry}
Jumlah karyawan: ${input.company.employee_band}

HASIL SKORING (deterministik, jangan diubah)
Total: ${input.score.total_score}/100 · Level ${input.score.level} · ${input.score.verdict}
${dims}

JAWABAN RESPONDEN
${jawaban}`
}

/** Membatasi nilai model agar tidak merusak tampilan. */
const clamp = (n: unknown): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50
}

const SEVERITIES: FlagSeverity[] = ['low', 'medium', 'high']

/**
 * Menormalkan balasan model.
 * Model bisa menyimpang dari skema; menyaring di sini menjaga agar UI dan
 * basis data tidak pernah menerima bentuk yang tak terduga.
 */
export function normalizeReview(raw: unknown, model: string, at: string): ReviewResult {
  const o = (raw ?? {}) as Record<string, unknown>
  const flags = Array.isArray(o.flags) ? o.flags : []
  return {
    data_quality: clamp(o.data_quality),
    summary: typeof o.summary === 'string' && o.summary.trim()
      ? o.summary.trim()
      : 'Tinjauan tidak menghasilkan ringkasan.',
    flags: flags.slice(0, 6).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>
      const sev = String(x.severity ?? '').toLowerCase() as FlagSeverity
      return {
        question_codes: Array.isArray(x.question_codes)
          ? x.question_codes.map(String).slice(0, 8) : [],
        severity: SEVERITIES.includes(sev) ? sev : 'low',
        issue: String(x.issue ?? '').trim() || 'Temuan tanpa keterangan',
        follow_up: String(x.follow_up ?? '').trim(),
      }
    }).filter((f) => f.issue !== ''),
    next_checks: (Array.isArray(o.next_checks) ? o.next_checks : [])
      .map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4),
    model,
    reviewed_at: at,
  }
}

export async function reviewAnswers(
  client: ChatClient,
  input: ReviewInput,
  now: () => Date = () => new Date(),
): Promise<ReviewResult> {
  if (input.answers.length === 0) {
    throw new AiError('Tidak ada jawaban untuk ditinjau')
  }
  const text = await client.complete([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildReviewPrompt(input) },
  ], { json: true })
  return normalizeReview(parseJsonReply(text), client.model, now().toISOString())
}
