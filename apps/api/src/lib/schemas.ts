/**
 * Skema TypeBox yang mencerminkan contracts/openapi.yaml.
 * Sesuai ADR-006/007: skema ini memvalidasi runtime sekaligus menghasilkan OpenAPI.
 */
import { t } from 'elysia'

export const ErrorCode = t.Union([
  t.Literal('UNAUTHENTICATED'), t.Literal('FORBIDDEN'), t.Literal('NOT_FOUND'),
  t.Literal('CONFLICT'), t.Literal('INCOMPLETE'), t.Literal('INVALID_ANSWER_TYPE'),
  t.Literal('QUESTION_NOT_VISIBLE'), t.Literal('RATE_LIMITED'),
  t.Literal('INVITATION_INVALID'), t.Literal('INTERNAL'),
])

export const ErrorEnvelope = t.Object({
  error: t.Object({
    code: ErrorCode,
    message: t.String(),
    details: t.Optional(t.Record(t.String(), t.Unknown())),
    trace_id: t.Optional(t.String()),
  }),
})

export const Industry = t.Union([
  t.Literal('manufacturing'), t.Literal('retail_ecommerce'), t.Literal('fnb'),
  t.Literal('logistics'), t.Literal('financial_services'), t.Literal('healthcare'),
  t.Literal('education'), t.Literal('professional_services'),
  t.Literal('construction_property'), t.Literal('agriculture'),
  t.Literal('media_creative'), t.Literal('technology'),
  t.Literal('government_public'), t.Literal('other'),
])

export const EmployeeBand = t.Union([
  t.Literal('1_9'), t.Literal('10_49'), t.Literal('50_99'),
  t.Literal('100_499'), t.Literal('500_999'), t.Literal('1000_plus'),
])

export const RevenueBand = t.Union([
  t.Literal('under_2_5b'), t.Literal('2_5b_15b'), t.Literal('15b_50b'),
  t.Literal('50b_250b'), t.Literal('250b_plus'), t.Literal('undisclosed'),
])

export const CompanyInput = t.Object({
  name: t.String({ minLength: 2, maxLength: 120 }),
  industry: Industry,
  employee_band: EmployeeBand,
  revenue_band: t.Optional(RevenueBand),
  country: t.Optional(t.String({ default: 'ID' })),
  province: t.Optional(t.String()),
})

export const Company = t.Composite([
  CompanyInput,
  t.Object({
    id: t.String(),
    owner_auditor_id: t.String(),
    created_at: t.String(),
  }),
])

export const AssessmentType = t.Literal('FULL')

export const InvitationStatus = t.Union([
  t.Literal('SENT'), t.Literal('OPENED'), t.Literal('IN_PROGRESS'),
  t.Literal('SUBMITTED'), t.Literal('SCORED'), t.Literal('REVOKED'), t.Literal('EXPIRED'),
])
export const AssessmentStatus = t.Union([
  t.Literal('IN_PROGRESS'), t.Literal('SUBMITTED'), t.Literal('SCORED'), t.Literal('ARCHIVED'),
])

export const AnswerValue = t.Union([
  t.Object({ choice: t.String() }),
  t.Object({ choices: t.Array(t.String()) }),
  t.Object({ scale: t.Integer({ minimum: 1, maximum: 5 }) }),
  t.Object({ bool: t.Boolean() }),
  t.Object({ number: t.Number() }),
  t.Object({ text: t.String({ maxLength: 1000 }) }),
])

export const AnswerInput = t.Object({
  question_code: t.String(),
  value: AnswerValue,
  evidence_url: t.Optional(t.String({ format: 'uri' })),
})

export const AnswerBatch = t.Object({
  client_revision: t.Optional(t.Integer({ minimum: 0 })),
  answers: t.Array(AnswerInput, { minItems: 1, maxItems: 50 }),
})

export const Progress = t.Object({
  answered: t.Integer(),
  total_visible: t.Integer(),
  percent: t.Number({ minimum: 0, maximum: 100 }),
  estimated_minutes_left: t.Integer(),
})

export const Assessment = t.Object({
  id: t.String(),
  organization_id: t.String(),
  type: AssessmentType,
  status: AssessmentStatus,
  questionnaire_version: t.String(),
  rubric_version: t.String(),
  started_at: t.String(),
  submitted_at: t.Union([t.String(), t.Null()]),
  progress: Progress,
})

export const AssessmentDetail = t.Composite([
  Assessment,
  t.Object({
    server_revision: t.Integer(),
    answers: t.Array(t.Composite([AnswerInput, t.Object({ answered_at: t.String() })])),
  }),
])

export const SaveResult = t.Object({
  saved: t.Integer(),
  server_revision: t.Integer(),
  progress: Progress,
  newly_visible: t.Array(t.String()),
  newly_hidden: t.Array(t.String()),
})

export const Invitation = t.Object({
  id: t.String(),
  company_id: t.String(),
  company_name: t.String(),
  assessment_id: t.String(),
  status: InvitationStatus,
  recipient_name: t.Optional(t.String()),
  recipient_email: t.Optional(t.String()),
  progress: Progress,
  issued_at: t.String(),
  opened_at: t.Union([t.String(), t.Null()]),
  submitted_at: t.Union([t.String(), t.Null()]),
  expires_at: t.String(),
  reminder_count: t.Integer(),
})

export const InvitationCreated = t.Composite([
  Invitation,
  t.Object({
    token: t.String(),
    invitation_url: t.String(),
    qr_png_url: t.String(),
    qr_svg_url: t.String(),
  }),
])

export const FormWelcome = t.Object({
  company_name: t.String(),
  invited_by: t.String(),
  total_questions: t.Integer(),
  estimated_minutes: t.Integer(),
  status: InvitationStatus,
  progress: Progress,
  expires_at: t.String(),
  resume: t.Boolean(),
})

export const QuestionOption = t.Object({
  code: t.String(), label: t.String(), score: t.Number(),
})

export const Question = t.Object({
  code: t.String(),
  dimension_code: t.String(),
  type: t.String(),
  prompt: t.String(),
  help_text: t.Optional(t.String()),
  weight: t.Number(),
  required: t.Boolean(),
  options: t.Optional(t.Array(QuestionOption)),
  min_select: t.Optional(t.Integer()),
  max_select: t.Optional(t.Integer()),
})

export const Dimension = t.Object({
  code: t.String(), name: t.String(), weight: t.Number(),
})

export const SectionPayload = t.Object({
  dimension: Dimension,
  section_index: t.Integer(),
  section_total: t.Integer(),
  questions: t.Array(Question),
  answers: t.Array(AnswerInput),
  progress: Progress,
})

export const DimensionScore = t.Object({
  dimension_code: t.String(),
  name: t.String(),
  score: t.Number(),
  level: t.Integer({ minimum: 1, maximum: 5 }),
  weight: t.Number(),
  benchmark_percentile: t.Optional(t.Union([t.Number(), t.Null()])),
})

export const Gate = t.Object({
  code: t.Union([t.Literal('DATA_FOUNDATION_GATE'), t.Literal('GOVERNANCE_GATE')]),
  triggered: t.Boolean(),
  message: t.String(),
})

export const Verdict = t.Union([
  t.Literal('READY'), t.Literal('CONDITIONALLY_READY'), t.Literal('NOT_READY'),
])

export const ScoreResult = t.Object({
  assessment_id: t.String(),
  total_score: t.Number({ minimum: 0, maximum: 100 }),
  level: t.Integer({ minimum: 1, maximum: 5 }),
  verdict: Verdict,
  confidence: t.Union([t.Literal('LOW'), t.Literal('MEDIUM'), t.Literal('HIGH')]),
  gates: t.Array(Gate),
  dimensions: t.Array(DimensionScore),
  benchmark_available: t.Boolean(),
  rubric_version: t.String(),
  computed_at: t.String(),
  summary: t.String(),
})

export const Recommendation = t.Object({
  code: t.String(),
  title: t.String(),
  body: t.String(),
  dimension_code: t.String(),
  impact: t.Integer({ minimum: 1, maximum: 5 }),
  effort: t.Integer({ minimum: 1, maximum: 5 }),
  priority_score: t.Number(),
  horizon: t.Union([t.Literal('0_3M'), t.Literal('3_6M'), t.Literal('6_12M')]),
  owner_role: t.String(),
  cost_band: t.String(),
  rank: t.Integer(),
})

export const RecommendationBundle = t.Object({
  items: t.Array(Recommendation, { minItems: 3 }),
  roadmap: t.Object({
    '0_3M': t.Array(t.String()),
    '3_6M': t.Array(t.String()),
    '6_12M': t.Array(t.String()),
  }),
})

export const QuickCheckResult = t.Object({
  total_score: t.Number(),
  level: t.Integer({ minimum: 1, maximum: 5 }),
  verdict: Verdict,
  confidence: t.Literal('LOW'),
  teaser: t.String(),
  upgrade_cta: t.String(),
})
