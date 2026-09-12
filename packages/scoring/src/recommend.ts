/**
 * Mesin rekomendasi (FR-14, BA3).
 * Murni dan deterministik: urutan hasil stabil untuk input yang sama.
 */
import type {
  Horizon, Recommendation, RecommendationBundle,
  RecommendationCatalogItem, ScoreResult,
} from './types'

export const HORIZONS: readonly Horizon[] = ['0_3M', '3_6M', '6_12M'] as const

/** Ambang pemicu default: pertanyaan dengan skor di bawah ini dianggap gap (FR-14). */
export const GAP_THRESHOLD = 60

/**
 * Menghasilkan rekomendasi berprioritas dari hasil skoring.
 * - Deduplikasi berdasar `code` (FR-14 AC2)
 * - Urut berdasar priority_score = impact / effort (FR-14 AC1)
 * - Maksimal 10 item; minimal 3 dijamin lewat pengisian berbasis dimensi terlemah
 * - Kuota per horizon menjaga roadmap tetap berisi di ketiga jangka waktu
 */
export function recommend(
  result: ScoreResult,
  catalog: readonly RecommendationCatalogItem[],
  options: { max?: number; min?: number } = {},
): RecommendationBundle {
  const max = options.max ?? 10
  const min = options.min ?? 3

  const scoreByQuestion = new Map(
    result.breakdown
      .filter((b) => b.visible && b.score !== null)
      .map((b) => [b.question_code, b.score!] as const),
  )

  const matched = new Map<string, RecommendationCatalogItem>()
  for (const item of catalog) {
    const fired = item.triggers.some((t) => {
      const s = scoreByQuestion.get(t.question_code)
      return s !== undefined && s <= t.max_score
    })
    if (fired) matched.set(item.code, item)
  }

  // Jaminan minimum (BA3): bila pemicu spesifik kurang, isi dengan rekomendasi
  // dari dimensi berskor terendah. Kandidat yang pemicunya jelas sudah terpenuhi
  // dikesampingkan lebih dulu agar saran tetap relevan, tetapi tetap dipakai
  // sebagai cadangan terakhir supaya BA3 tidak pernah dilanggar.
  if (matched.size < min) {
    const weakestFirst = [...result.dimensions]
      .filter((d) => d.counted_questions > 0)
      .sort((a, b) => a.score - b.score || a.dimension_code.localeCompare(b.dimension_code))

    const fillFrom = (predicate: (c: RecommendationCatalogItem) => boolean) => {
      for (const dim of weakestFirst) {
        if (matched.size >= min) return
        const fillers = catalog
          .filter((c) => c.dimension_code === dim.dimension_code && !matched.has(c.code))
          .filter(predicate)
          .sort(byPriorityThenCode)
        for (const f of fillers) {
          if (matched.size >= min) return
          matched.set(f.code, f)
        }
      }
    }
    // Urutan pengisian mencerminkan kegunaan bagi pengguna:
    // 1) langkah lanjutan (tanpa pemicu) untuk organisasi yang sudah matang,
    // 2) rekomendasi gap yang masih relevan,
    // 3) apa pun yang tersisa, agar BA3 tidak pernah dilanggar.
    fillFrom((c) => c.triggers.length === 0)
    fillFrom((c) => c.triggers.length > 0 && !alreadySatisfied(c, scoreByQuestion))
    fillFrom(() => true)
  }

  const selected = selectWithHorizonQuota([...matched.values()], max, min)

  const items: Recommendation[] = selected.map((item, i) => ({
    ...item,
    priority_score: round2(item.impact / item.effort),
    rank: i + 1,
  }))

  const roadmap: Record<Horizon, string[]> = { '0_3M': [], '3_6M': [], '6_12M': [] }
  for (const item of items) roadmap[item.horizon].push(item.code)

  return { items, roadmap }
}

/**
 * Sebuah rekomendasi dianggap sudah terpenuhi bila SEMUA pertanyaan pemicunya
 * sudah dijawab dengan skor jauh di atas ambang. Mencegah saran seperti
 * "susun kamus metrik" muncul pada perusahaan yang kamus metriknya sudah ada.
 */
function alreadySatisfied(
  item: RecommendationCatalogItem,
  scoreByQuestion: ReadonlyMap<string, number>,
): boolean {
  const answered = item.triggers.filter((t) => scoreByQuestion.has(t.question_code))
  if (answered.length === 0) return false
  return answered.every((t) => scoreByQuestion.get(t.question_code)! > t.max_score)
}

/**
 * Memilih hingga `max` item sambil menjaga roadmap tetap berimbang.
 *
 * Tanpa kuota, pengurutan murni impact/effort selalu memenangkan quick win
 * jangka pendek sehingga horizon 3–6 dan 6–12 bulan selalu kosong dan roadmap
 * kehilangan maknanya. Kuota menyisakan tempat untuk pekerjaan fondasi yang
 * usahanya besar tetapi dampaknya tinggi.
 */
function selectWithHorizonQuota(
  candidates: readonly RecommendationCatalogItem[],
  max: number,
  min: number,
): RecommendationCatalogItem[] {
  const sorted = [...candidates].sort(byPriorityThenCode)
  if (sorted.length <= min) return sorted

  const RESERVED: Record<Horizon, number> = { '0_3M': 0, '3_6M': 2, '6_12M': 1 }
  const chosen: RecommendationCatalogItem[] = []
  const taken = new Set<string>()

  // Tahap 1: penuhi kuota horizon menengah/panjang lebih dulu.
  // Di dalam kuota ini urutannya berdasar DAMPAK, bukan rasio impact/effort:
  // slot jangka panjang memang diperuntukkan bagi pekerjaan fondasi yang
  // usahanya besar. Memakai rasio di sini akan selalu menggusurnya.
  for (const h of ['3_6M', '6_12M'] as const) {
    const quota = RESERVED[h]
    const pool = sorted.filter((x) => x.horizon === h).sort(byImpactThenCode)
    for (const item of pool) {
      if (chosen.filter((c) => c.horizon === h).length >= quota) break
      if (chosen.length >= max) break
      chosen.push(item)
      taken.add(item.code)
    }
  }

  // Tahap 2: isi sisa slot dengan prioritas tertinggi apa pun horizonnya.
  for (const item of sorted) {
    if (chosen.length >= max) break
    if (taken.has(item.code)) continue
    chosen.push(item)
    taken.add(item.code)
  }

  return chosen.sort(byPriorityThenCode)
}

/** Urutan stabil: priority desc, impact desc, lalu code asc sebagai tie-break. */
function byPriorityThenCode(
  a: RecommendationCatalogItem,
  b: RecommendationCatalogItem,
): number {
  const pa = a.impact / a.effort
  const pb = b.impact / b.effort
  if (pb !== pa) return pb - pa
  if (b.impact !== a.impact) return b.impact - a.impact
  return a.code.localeCompare(b.code)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Urutan untuk slot jangka panjang: dampak tertinggi dulu, lalu usaha terkecil. */
function byImpactThenCode(
  a: RecommendationCatalogItem,
  b: RecommendationCatalogItem,
): number {
  if (b.impact !== a.impact) return b.impact - a.impact
  if (a.effort !== b.effort) return a.effort - b.effort
  return a.code.localeCompare(b.code)
}
