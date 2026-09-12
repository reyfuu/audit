/**
 * Evaluator DSL visibilitas (TRD §5).
 * Fungsi murni tanpa eval dinamis: aturan hanyalah data.
 */
import type { Answer, AnswerValue, Condition, VisibilityRule } from './types'

/** Ekstrak nilai pembanding skalar dari sebuah AnswerValue. */
export function primitiveOf(value: AnswerValue): string | number | boolean | string[] {
  if ('choice' in value) return value.choice
  if ('choices' in value) return value.choices
  if ('scale' in value) return value.scale
  if ('bool' in value) return value.bool
  if ('number' in value) return value.number
  return value.text
}

function isCondition(rule: VisibilityRule): rule is Condition {
  return 'question' in rule
}

function compare(op: Condition['op'], actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined
    case 'eq':
      return Array.isArray(actual) ? false : actual === expected
    case 'neq':
      return actual !== expected
    case 'in':
      return Array.isArray(expected)
        ? Array.isArray(actual)
          ? actual.some((a) => expected.includes(a))
          : expected.includes(actual)
        : false
    case 'nin':
      return Array.isArray(expected)
        ? Array.isArray(actual)
          ? !actual.some((a) => expected.includes(a))
          : !expected.includes(actual)
        : false
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') return false
      if (op === 'gt') return actual > expected
      if (op === 'gte') return actual >= expected
      if (op === 'lt') return actual < expected
      return actual <= expected
    }
  }
}

/**
 * Mengevaluasi aturan visibilitas terhadap jawaban saat ini.
 * Aturan yang tidak ada berarti pertanyaan selalu tampil.
 */
export function isVisible(
  rule: VisibilityRule | undefined,
  answersByCode: ReadonlyMap<string, Answer>,
): boolean {
  if (!rule) return true

  if (isCondition(rule)) {
    const answer = answersByCode.get(rule.question)
    // Tanpa jawaban, tidak ada kondisi yang dapat terpenuhi, termasuk `exists`.
    if (!answer) return false
    return compare(rule.op, primitiveOf(answer.value), rule.value)
  }
  if ('all' in rule) return rule.all.every((r) => isVisible(r, answersByCode))
  if ('any' in rule) return rule.any.some((r) => isVisible(r, answersByCode))
  return !isVisible(rule.not, answersByCode)
}

/** Indeks jawaban berdasar question_code; jawaban terakhir menang (FR-09 AC1 upsert). */
export function indexAnswers(answers: readonly Answer[]): Map<string, Answer> {
  const m = new Map<string, Answer>()
  for (const a of answers) m.set(a.question_code, a)
  return m
}
