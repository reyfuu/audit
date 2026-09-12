/**
 * Uji keselarasan implementasi dengan dokumen.
 * Mencegah kode dan docs/QUESTION_BANK.md serta contracts/openapi.yaml saling melenceng.
 */
import { describe, it, expect } from 'bun:test'
import { QUESTIONNAIRE_V1, RECOMMENDATION_CATALOG, DIMENSION_CODES, SECTION_NAMES } from '../src'

const ROOT = new URL('../../../', import.meta.url).pathname
const qb = await Bun.file(`${ROOT}docs/QUESTION_BANK.md`).text()
const spec = await Bun.file(`${ROOT}contracts/openapi.yaml`).text()

const QN = QUESTIONNAIRE_V1

describe('keselarasan dengan docs/QUESTION_BANK.md', () => {
  it('semua pertanyaan berskor di dokumen terimplementasi di kode', () => {
    const documented = [...qb.matchAll(/\*\*([A-Z]{3}-\d{2}) \(/g)].map((m) => m[1]!)
    const implemented = new Set(QN.questions.map((q) => q.code))
    const missing = documented.filter((c) => !implemented.has(c))
    expect(missing).toEqual([])
  })

  it('tidak ada pertanyaan di kode yang tidak terdokumentasi', () => {
    const documented = new Set([...qb.matchAll(/\*\*([A-Z]{3}-\d{2}) \(/g)].map((m) => m[1]!))
    const extra = QN.questions
      .filter((q) => !q.unscored)
      .map((q) => q.code)
      .filter((c) => !documented.has(c))
    expect(extra).toEqual([])
  })

  it('bobot dimensi di kode sama dengan dokumen', () => {
    const expected: Record<string, number> = {
      STR: 0.15, DAT: 0.25, TEC: 0.15, PPL: 0.15, PRC: 0.10, GOV: 0.10, FIN: 0.10,
    }
    for (const d of QN.dimensions) expect(d.weight).toBe(expected[d.code]!)
  })

  it('bobot pertanyaan di kode sama dengan w= di dokumen', () => {
    const documented = new Map(
      [...qb.matchAll(/\*\*([A-Z]{3}-\d{2}) \([A-Z0-9]+, w=(\d+)/g)]
        .map((m) => [m[1]!, Number(m[2])] as const),
    )
    for (const q of QN.questions) {
      const w = documented.get(q.code)
      if (w === undefined) continue
      expect({ code: q.code, weight: q.weight }).toEqual({ code: q.code, weight: w })
    }
  })

  it('penanda pertanyaan inti di kode sama dengan daftar di dokumen', () => {
    const listed = new Set(
      qb.match(/## Pertanyaan Inti Penentu Kesiapan[\s\S]*?\n`(.+?)`/)![1]!
        .split(', ').map((s) => s.trim()),
    )
    for (const q of QN.questions) {
      if (q.unscored) continue
      expect({ code: q.code, quick: q.in_quick_check === true })
        .toEqual({ code: q.code, quick: listed.has(q.code) })
    }
  })

  it('semua kode rekomendasi di dokumen ada di katalog kode', () => {
    const documented = [...qb.matchAll(/\| (REC-[A-Z]{3}-\d{3}) \|/g)].map((m) => m[1]!)
    const implemented = new Set(RECOMMENDATION_CATALOG.map((r) => r.code))
    expect(documented.filter((c) => !implemented.has(c))).toEqual([])
  })
})

describe('keselarasan dengan contracts/openapi.yaml', () => {
  it('DimensionCode di kode sama dengan enum di kontrak', () => {
    const enumLine = spec.match(/DimensionCode:\s*\n\s*type: string\s*\n\s*enum: \[(.+?)\]/)![1]!
    const fromSpec: string[] = enumLine.split(',').map((s) => s.trim()).sort()
    const fromCode: string[] = [...DIMENSION_CODES].sort()
    expect(fromCode).toEqual(fromSpec)
  })

  it('verdict yang mungkin dihasilkan kode ada di enum kontrak', () => {
    const enumLine = spec.match(/Verdict: \{ type: string, enum: \[(.+?)\] \}/)![1]!
    const fromSpec = enumLine.split(',').map((s) => s.trim())
    for (const v of ['READY', 'CONDITIONALLY_READY', 'NOT_READY']) {
      expect(fromSpec).toContain(v)
    }
  })

  it('kode gate di kode sama dengan enum Gate di kontrak', () => {
    const enumLine = spec.match(/Gate:[\s\S]*?enum: \[(.+?)\]/)![1]!
    const fromSpec = enumLine.split(',').map((s) => s.trim()).sort()
    expect(fromSpec).toEqual(['DATA_FOUNDATION_GATE', 'GOVERNANCE_GATE'])
  })

  it('horizon di katalog sama dengan enum kontrak', () => {
    const allowed = new Set(['0_3M', '3_6M', '6_12M'])
    for (const r of RECOMMENDATION_CATALOG) expect(allowed.has(r.horizon)).toBe(true)
  })

  it('cost_band di katalog sama dengan enum kontrak', () => {
    const enumLine = spec.match(/cost_band: \{ type: string, enum: \[(.+?)\] \}/)![1]!
    const allowed = new Set(enumLine.split(',').map((s) => s.trim()))
    for (const r of RECOMMENDATION_CATALOG) expect(allowed.has(r.cost_band)).toBe(true)
  })
})

describe('integritas kuesioner', () => {
  it('kode pertanyaan unik', () => {
    const codes = QN.questions.map((q) => q.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('setiap pertanyaan merujuk seksi yang terdaftar', () => {
    // Seksi sah = tujuh dimensi berskor + seksi profil ORG yang tidak diskor.
    const sections = new Set<string>([...QN.dimensions.map((d) => d.code), 'ORG'])
    for (const q of QN.questions) expect(sections.has(q.dimension_code)).toBe(true)
  })

  it('pertanyaan di seksi ORG selalu unscored dan berbobot 0', () => {
    for (const q of QN.questions.filter((x) => x.dimension_code === 'ORG')) {
      expect(q.unscored).toBe(true)
      expect(q.weight).toBe(0)
    }
  })

  it('setiap seksi punya nama tampilan', () => {
    const used = new Set(QN.questions.map((q) => q.dimension_code))
    for (const s of used) expect(SECTION_NAMES[s]).toBeTruthy()
  })

  it('setiap pertanyaan pilihan punya opsi dengan kode unik', () => {
    for (const q of QN.questions) {
      if (q.type !== 'single_choice' && q.type !== 'multi_choice') continue
      expect(q.options?.length ?? 0).toBeGreaterThan(1)
      const codes = q.options!.map((o) => o.code)
      expect(new Set(codes).size).toBe(codes.length)
    }
  })

  it('skor opsi selalu 0..100', () => {
    for (const q of QN.questions) {
      for (const o of q.options ?? []) {
        expect(o.score).toBeGreaterThanOrEqual(0)
        expect(o.score).toBeLessThanOrEqual(100)
      }
    }
  })

  it('pertanyaan berskor punya bobot > 0, pertanyaan unscored berbobot 0', () => {
    for (const q of QN.questions) {
      if (q.unscored) expect(q.weight).toBe(0)
      else expect(q.weight).toBeGreaterThan(0)
    }
  })

  it('aturan visibilitas hanya merujuk pertanyaan yang ada', () => {
    const codes = new Set(QN.questions.map((q) => q.code))
    for (const q of QN.questions) {
      const rule = q.visibility_rule
      if (!rule || !('question' in rule)) continue
      expect(codes.has(rule.question)).toBe(true)
    }
  })

  it('setiap pertanyaan punya prompt yang jelas dan diakhiri tanda tanya', () => {
    for (const q of QN.questions) {
      expect(q.prompt.length).toBeGreaterThan(15)
      expect(q.prompt.endsWith('?')).toBe(true)
    }
  })

  it('label opsi tidak kosong dan tidak duplikat dalam satu pertanyaan', () => {
    for (const q of QN.questions) {
      const labels = (q.options ?? []).map((o) => o.label)
      for (const l of labels) expect(l.length).toBeGreaterThan(2)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('setiap dimensi punya minimal 4 pertanyaan berskor', () => {
    for (const d of QN.dimensions) {
      const n = QN.questions.filter((q) => q.dimension_code === d.code && !q.unscored).length
      expect(n).toBeGreaterThanOrEqual(4)
    }
  })
})
