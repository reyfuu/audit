/**
 * Mesin skoring (FRD §5, BR-01..BR-09).
 * Fungsi murni: score(input) selalu menghasilkan output identik untuk input identik.
 */
import type {
  Answer, AnswerValue, Confidence, Dimension, DimensionScore, Gate,
  MaturityLevel, Question, QuestionScore, ScoreResult, ScoringInput, Verdict,
} from './types'
import { indexAnswers, isVisible } from './visibility'

/** Pembulatan half-up ke n desimal; menghindari kejutan floating point (BR-03). */
export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals
  // epsilon kecil mengoreksi representasi biner seperti 1.005 -> 1.00499999
  return Math.round((value + Number.EPSILON) * f) / f
}

/** BR-04: pemetaan skor ke level maturitas. */
export function levelOf(score: number): MaturityLevel {
  if (score < 20) return 1
  if (score < 40) return 2
  if (score < 60) return 3
  if (score < 80) return 4
  return 5
}

/** BR-05: pemetaan skor total ke verdict, sebelum gate diterapkan. */
export function baseVerdict(total: number): Verdict {
  if (total >= 70) return 'READY'
  if (total >= 50) return 'CONDITIONALLY_READY'
  return 'NOT_READY'
}

const VERDICT_RANK: Record<Verdict, number> = {
  NOT_READY: 0, CONDITIONALLY_READY: 1, READY: 2,
}

/** Menurunkan verdict menjadi maksimal `cap`; tidak pernah menaikkan. */
function capVerdict(current: Verdict, cap: Verdict): Verdict {
  return VERDICT_RANK[current] > VERDICT_RANK[cap] ? cap : current
}

/**
 * BR-01: skor satu jawaban, 0..100.
 * Mengembalikan null bila pertanyaan tidak dapat diskor.
 */
export function scoreAnswer(question: Question, value: AnswerValue): number | null {
  switch (question.type) {
    case 'single_choice': {
      if (!('choice' in value)) return null
      const opt = question.options?.find((o) => o.code === value.choice)
      return opt ? clamp(opt.score) : null
    }
    case 'multi_choice': {
      if (!('choices' in value)) return null
      const options = question.options ?? []
      if (options.length === 0) return null
      const chosen = options.filter((o) => value.choices.includes(o.code))
      // Skor proporsional: rata-rata skor opsi terpilih, diskalakan jumlah pilihan.
      // Untuk pertanyaan inventaris (mis. DAT-07), makin banyak dimiliki makin tinggi.
      const allEqual = options.every((o) => o.score === options[0]!.score)
      if (allEqual) return clamp((chosen.length / options.length) * 100)
      const sum = chosen.reduce((acc, o) => acc + o.score, 0)
      return chosen.length === 0 ? 0 : clamp(sum / chosen.length)
    }
    case 'scale_1_5': {
      if (!('scale' in value)) return null
      if (!Number.isInteger(value.scale) || value.scale < 1 || value.scale > 5) return null
      return clamp(((value.scale - 1) / 4) * 100)
    }
    case 'boolean': {
      if (!('bool' in value)) return null
      return value.bool ? 100 : 0
    }
    case 'number': {
      if (!('number' in value)) return null
      const min = question.min ?? 0
      const max = question.max ?? 100
      if (max <= min) return null
      return clamp(((value.number - min) / (max - min)) * 100)
    }
    case 'text':
      return null // teks tidak pernah diskor (FRD §10)
  }
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n))
}

/** Pertanyaan yang ikut dihitung: berskor, dan untuk QUICK harus masuk quick check. */
function inScope(q: Question, mode: 'FULL' | 'QUICK'): boolean {
  if (q.unscored || q.type === 'text') return false
  return mode === 'FULL' ? true : q.in_quick_check === true
}

/**
 * Menghitung skor lengkap.
 * Deterministik: tidak memakai Date, Math.random, atau urutan iterasi tak stabil.
 */
export function score(input: ScoringInput): ScoreResult {
  const { questionnaire } = input
  const mode = input.mode ?? 'FULL'
  const byCode = indexAnswers(input.answers)

  // ── 1. Skor tiap pertanyaan, sekaligus catat visibilitas (snapshot ADR-004)
  const breakdown: QuestionScore[] = []
  for (const q of questionnaire.questions) {
    if (!inScope(q, mode)) continue
    const visible = isVisible(q.visibility_rule, byCode)
    const answer = byCode.get(q.code)
    const raw = visible && answer ? scoreAnswer(q, answer.value) : null
    breakdown.push({
      question_code: q.code,
      dimension_code: q.dimension_code,
      score: raw,
      weight: q.weight,
      visible,
      answered: answer !== undefined,
      has_evidence: Boolean(answer?.evidence_url),
    })
  }

  // ── 2. BR-02 skor per dimensi; pertanyaan tak-visible dikeluarkan dari
  //      pembilang DAN penyebut sehingga tidak menghukum responden.
  const dimensions: DimensionScore[] = questionnaire.dimensions.map((d) =>
    scoreDimension(d, breakdown),
  )

  // ── 3. BR-03 skor total tertimbang, dinormalisasi terhadap dimensi yang
  //      benar-benar punya pertanyaan (penting untuk mode QUICK).
  const contributing = dimensions.filter((d) => d.counted_questions > 0)
  const weightSum = contributing.reduce((acc, d) => acc + d.weight, 0)
  const total = weightSum === 0
    ? 0
    : round(contributing.reduce((acc, d) => acc + d.score * d.weight, 0) / weightSum)

  // ── 4. BR-06 & BR-07 hard gate
  const dat = dimensions.find((d) => d.dimension_code === 'DAT')
  const gov = dimensions.find((d) => d.dimension_code === 'GOV')
  const gates: Gate[] = [
    {
      code: 'DATA_FOUNDATION_GATE',
      triggered: Boolean(dat && dat.counted_questions > 0 && dat.score < 40),
      message: 'Fondasi data di bawah ambang 40; AI tidak akan berhasil tanpa data yang siap.',
    },
    {
      code: 'GOVERNANCE_GATE',
      triggered: Boolean(gov && gov.counted_questions > 0 && gov.score < 30),
      message: 'Tata kelola di bawah ambang 30; risiko kepatuhan perlu ditutup lebih dulu.',
    },
  ]

  let verdict = baseVerdict(total)
  if (gates[0]!.triggered) verdict = 'NOT_READY'
  if (gates[1]!.triggered) verdict = capVerdict(verdict, 'CONDITIONALLY_READY')

  return {
    total_score: total,
    level: levelOf(total),
    verdict,
    confidence: confidenceOf(breakdown, mode),
    gates,
    dimensions,
    rubric_version: questionnaire.rubric_version,
    breakdown,
  }
}

function scoreDimension(d: Dimension, breakdown: readonly QuestionScore[]): DimensionScore {
  const counted = breakdown.filter(
    (b) => b.dimension_code === d.code && b.visible && b.score !== null,
  )
  const weightSum = counted.reduce((acc, b) => acc + b.weight, 0)
  const value = weightSum === 0
    ? 0
    : round(counted.reduce((acc, b) => acc + b.score! * b.weight, 0) / weightSum)
  return {
    dimension_code: d.code,
    name: d.name,
    score: value,
    level: levelOf(value),
    weight: d.weight,
    counted_questions: counted.length,
  }
}

/** BR-09: confidence naik seiring bukti terlampir; QUICK selalu LOW. */
export function confidenceOf(
  breakdown: readonly QuestionScore[],
  mode: 'FULL' | 'QUICK',
): Confidence {
  if (mode === 'QUICK') return 'LOW'
  const scored = breakdown.filter((b) => b.visible && b.score !== null)
  if (scored.length === 0) return 'LOW'
  const ratio = scored.filter((b) => b.has_evidence).length / scored.length
  const value = 0.6 + 0.4 * ratio
  if (value >= 0.9) return 'HIGH'
  if (value >= 0.7) return 'MEDIUM'
  return 'LOW'
}

/**
 * FR-12 AC1: daftar pertanyaan wajib & visible yang belum terjawab.
 * Dipakai API untuk menolak submit dengan 422 INCOMPLETE.
 */
export function missingRequired(
  answers: readonly Answer[],
  questionnaire: { questions: Question[] },
  mode: 'FULL' | 'QUICK' = 'FULL',
): string[] {
  const byCode = indexAnswers(answers)
  return questionnaire.questions
    .filter((q) => q.required && inScope(q, mode))
    .filter((q) => isVisible(q.visibility_rule, byCode))
    .filter((q) => {
      const a = byCode.get(q.code)
      return !a || scoreAnswer(q, a.value) === null
    })
    .map((q) => q.code)
}

/** FR-08: pertanyaan yang saat ini tampil, untuk progress bar. */
export function visibleQuestions(
  answers: readonly Answer[],
  questionnaire: { questions: Question[] },
  mode: 'FULL' | 'QUICK' = 'FULL',
): Question[] {
  const byCode = indexAnswers(answers)
  return questionnaire.questions
    .filter((q) => mode === 'FULL' || q.in_quick_check === true || q.unscored)
    .filter((q) => isVisible(q.visibility_rule, byCode))
}
