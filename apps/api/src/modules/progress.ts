/**
 * Perhitungan progres dan visibilitas, dipakai bersama oleh modul undangan
 * (dashboard auditor) dan modul responden (progress bar).
 */
import {
  QUESTIONNAIRE_V1 as QN, indexAnswers, isVisible,
  type Answer, type Question,
} from '@siapai/scoring'
import type { AssessmentRow } from '../lib/repo'

/** Estimasi durasi pengisian per pertanyaan, untuk sisa waktu di UI (DESIGN B4). */
export const SECONDS_PER_QUESTION = 25

export function answersOf(a: AssessmentRow): Answer[] {
  return [...a.answers.values()].map(({ question_code, value, evidence_url }) => ({
    question_code, value, ...(evidence_url ? { evidence_url } : {}),
  }))
}

export function visibleQuestionsOf(a: AssessmentRow): Question[] {
  const idx = indexAnswers(answersOf(a))
  return QN.questions.filter((q) => isVisible(q.visibility_rule, idx))
}

export function progressOf(a: AssessmentRow) {
  const visible = visibleQuestionsOf(a)
  const codes = new Set(visible.map((q) => q.code))
  const answered = [...a.answers.keys()].filter((c) => codes.has(c)).length
  const total = codes.size
  const remaining = Math.max(0, total - answered)
  return {
    answered,
    total_visible: total,
    percent: total === 0 ? 0 : Math.round((answered / total) * 1000) / 10,
    estimated_minutes_left: Math.ceil((remaining * SECONDS_PER_QUESTION) / 60),
  }
}
