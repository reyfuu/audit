/**
 * Tipe inti mesin skoring. Mencerminkan components.schemas di contracts/openapi.yaml.
 * Paket ini murni: tanpa I/O, tanpa tanggal, tanpa acak. Lihat TRD §5 dan ADR-002.
 */

export type DimensionCode = 'STR' | 'DAT' | 'TEC' | 'PPL' | 'PRC' | 'GOV' | 'FIN'

export const DIMENSION_CODES: readonly DimensionCode[] = [
  'STR', 'DAT', 'TEC', 'PPL', 'PRC', 'GOV', 'FIN',
] as const

export type QuestionType =
  | 'single_choice' | 'multi_choice' | 'scale_1_5' | 'boolean' | 'number' | 'text'

export type MaturityLevel = 1 | 2 | 3 | 4 | 5
export type Verdict = 'READY' | 'CONDITIONALLY_READY' | 'NOT_READY'
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH'
export type Horizon = '0_3M' | '3_6M' | '6_12M'

/** Nilai jawaban; bentuknya mengikuti tipe pertanyaan (FRD §10). */
export type AnswerValue =
  | { choice: string }
  | { choices: string[] }
  | { scale: number }
  | { bool: boolean }
  | { number: number }
  | { text: string }

export interface Answer {
  question_code: string
  value: AnswerValue
  /** Bukti opsional; menaikkan confidence (BR-09). */
  evidence_url?: string
}

export interface QuestionOption {
  code: string
  label: string
  /** Skor 0..100 (BR-01). */
  score: number
}

/** Operator DSL visibilitas (TRD §5). Evaluator murni, tanpa eval dinamis. */
export type ComparisonOp = 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists'

export interface Condition {
  question: string
  op: ComparisonOp
  value?: unknown
}

export type VisibilityRule =
  | Condition
  | { all: VisibilityRule[] }
  | { any: VisibilityRule[] }
  | { not: VisibilityRule }

export interface Question {
  code: string
  dimension_code: DimensionCode
  type: QuestionType
  prompt: string
  help_text?: string
  /** Bobot dalam dimensinya (BR-02). */
  weight: number
  required: boolean
  in_quick_check?: boolean
  options?: QuestionOption[]
  min_select?: number
  max_select?: number
  min?: number
  max?: number
  visibility_rule?: VisibilityRule
  /** true untuk pertanyaan profil/diagnostik yang tidak ikut skor. */
  unscored?: boolean
}

export interface Dimension {
  code: DimensionCode
  name: string
  /** Bobot dimensi; total semua dimensi harus 1.0 (BR-03). */
  weight: number
}

export interface Questionnaire {
  version: string
  rubric_version: string
  dimensions: Dimension[]
  questions: Question[]
}

/** Pemicu rekomendasi: pertanyaan X mendapat skor <= ambang. */
export interface RecommendationTrigger {
  question_code: string
  max_score: number
}

export interface RecommendationCatalogItem {
  code: string
  title: string
  body: string
  dimension_code: DimensionCode
  /** 1..5 */
  impact: number
  /** 1..5 */
  effort: number
  horizon: Horizon
  owner_role: string
  cost_band: 'under_10jt' | '10_30jt' | '30_100jt' | '100_500jt' | 'above_500jt'
  triggers: RecommendationTrigger[]
}

export interface DimensionScore {
  dimension_code: DimensionCode
  name: string
  score: number
  level: MaturityLevel
  weight: number
  /** Jumlah pertanyaan visible & berskor yang ikut dihitung. */
  counted_questions: number
}

export interface Gate {
  code: 'DATA_FOUNDATION_GATE' | 'GOVERNANCE_GATE'
  triggered: boolean
  message: string
}

export interface ScoringInput {
  answers: Answer[]
  questionnaire: Questionnaire
  /** Batasi ke subset Quick Check (PRD F03). */
  mode?: 'FULL' | 'QUICK'
}

export interface ScoreResult {
  total_score: number
  level: MaturityLevel
  verdict: Verdict
  confidence: Confidence
  gates: Gate[]
  dimensions: DimensionScore[]
  rubric_version: string
  /** Snapshot per pertanyaan untuk reproduksibilitas (ADR-004). */
  breakdown: QuestionScore[]
}

export interface QuestionScore {
  question_code: string
  dimension_code: DimensionCode
  /** null bila tidak visible atau tidak dijawab. */
  score: number | null
  weight: number
  visible: boolean
  answered: boolean
  has_evidence: boolean
}

export interface Recommendation extends RecommendationCatalogItem {
  priority_score: number
  rank: number
}

export interface RecommendationBundle {
  items: Recommendation[]
  roadmap: Record<Horizon, string[]>
}
