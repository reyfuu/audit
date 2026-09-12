/** Uji mesin rekomendasi (FR-14, BA3). */
import { describe, it, expect } from 'bun:test'
import {
  QUESTIONNAIRE_V1, RECOMMENDATION_CATALOG, recommend, score,
  type Answer, type Question, type Questionnaire,
} from '../src'

const QN = QUESTIONNAIRE_V1
const CAT = RECOMMENDATION_CATALOG

function answersWith(pick: 'lowest' | 'highest' | 'middle', overrides: Answer[] = []): Answer[] {
  const m = new Map<string, Answer>()
  for (const q of QN.questions) {
    if (q.type === 'text') continue
    m.set(q.code, { question_code: q.code, value: valueFor(q, pick) })
  }
  for (const o of overrides) m.set(o.question_code, o)
  return [...m.values()]
}

function valueFor(q: Question, pick: 'lowest' | 'highest' | 'middle'): Answer['value'] {
  switch (q.type) {
    case 'single_choice': {
      const s = [...(q.options ?? [])].sort((a, b) => a.score - b.score)
      const c = pick === 'lowest' ? s[0] : pick === 'highest' ? s[s.length - 1] : s[Math.floor(s.length / 2)]
      return { choice: c!.code }
    }
    case 'multi_choice': {
      const o = q.options ?? []
      if (pick === 'lowest') return { choices: [] }
      if (pick === 'highest') return { choices: o.map((x) => x.code) }
      return { choices: o.slice(0, Math.ceil(o.length / 2)).map((x) => x.code) }
    }
    case 'scale_1_5': return { scale: pick === 'lowest' ? 1 : pick === 'highest' ? 5 : 3 }
    case 'boolean': return { bool: pick === 'highest' }
    case 'number': return { number: pick === 'lowest' ? (q.min ?? 0) : (q.max ?? 100) }
    case 'text': return { text: '' }
  }
}

const resultFor = (pick: 'lowest' | 'highest' | 'middle', o: Answer[] = []) =>
  score({ answers: answersWith(pick, o), questionnaire: QN })

describe('FR-14 AC1 prioritas & urutan', () => {
  it('diurutkan menurun berdasar priority_score = impact / effort', () => {
    const { items } = recommend(resultFor('lowest'), CAT)
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.priority_score).toBeGreaterThanOrEqual(items[i]!.priority_score)
    }
  })

  it('rank berurutan mulai dari 1', () => {
    const { items } = recommend(resultFor('lowest'), CAT)
    expect(items.map((x) => x.rank)).toEqual(items.map((_, i) => i + 1))
  })

  it('priority_score dihitung benar', () => {
    const { items } = recommend(resultFor('lowest'), CAT)
    for (const it of items) {
      expect(it.priority_score).toBeCloseTo(it.impact / it.effort, 2)
    }
  })

  it('membatasi maksimal 10 item', () => {
    const { items } = recommend(resultFor('lowest'), CAT)
    expect(items.length).toBeLessThanOrEqual(10)
  })
})

describe('BA3 minimal 3 rekomendasi untuk semua profil', () => {
  it('profil terburuk mendapat minimal 3', () => {
    expect(recommend(resultFor('lowest'), CAT).items.length).toBeGreaterThanOrEqual(3)
  })

  it('profil sempurna tetap mendapat minimal 3 (pengisian dimensi terlemah)', () => {
    const { items } = recommend(resultFor('highest'), CAT)
    expect(items.length).toBeGreaterThanOrEqual(3)
  })

  it('profil menengah mendapat minimal 3', () => {
    expect(recommend(resultFor('middle'), CAT).items.length).toBeGreaterThanOrEqual(3)
  })

  it('jaminan minimum berlaku untuk 50 profil acak', () => {
    const rng = mulberry32(4242)
    for (let i = 0; i < 50; i++) {
      const answers: Answer[] = []
      for (const q of QN.questions) {
        if (q.type === 'text') continue
        answers.push({ question_code: q.code, value: randomValue(q, rng) })
      }
      const { items } = recommend(score({ answers, questionnaire: QN }), CAT)
      expect(items.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('FR-14 AC2 deduplikasi & pemicu', () => {
  it('tidak ada kode rekomendasi yang muncul dua kali', () => {
    const { items } = recommend(resultFor('lowest'), CAT)
    expect(new Set(items.map((x) => x.code)).size).toBe(items.length)
  })

  it('rekomendasi data muncul ketika DAT-01 terburuk', () => {
    const r = resultFor('highest', [{ question_code: 'DAT-01', value: { choice: 'opt_0' } }])
    const codes = recommend(r, CAT).items.map((x) => x.code)
    expect(codes).toContain('REC-DAT-001')
  })

  it('rekomendasi tidak muncul saat pemicunya tidak terpenuhi', () => {
    const r = resultFor('highest')
    const codes = recommend(r, CAT).items.map((x) => x.code)
    expect(codes).not.toContain('REC-DAT-001')
  })

  it('pemicu memakai <= sehingga skor tepat di ambang ikut memicu', () => {
    // REC-GOV-002 memicu pada GOV-01 <= 50
    const r = resultFor('highest', [{ question_code: 'GOV-01', value: { choice: 'opt_50' } }])
    expect(recommend(r, CAT).items.map((x) => x.code)).toContain('REC-GOV-002')
  })

  it('pertanyaan tidak visible tidak memicu rekomendasi', () => {
    // PPL-07 tidak tampil untuk perusahaan kecil, jadi tidak boleh jadi pemicu
    const r = resultFor('highest', [{ question_code: 'ORG-02', value: { choice: '10_49' } }])
    const ppl07 = r.breakdown.find((b) => b.question_code === 'PPL-07')
    expect(ppl07?.visible).toBe(false)
  })
})

describe('FR-09 roadmap', () => {
  it('setiap item masuk tepat satu horizon', () => {
    const { items, roadmap } = recommend(resultFor('lowest'), CAT)
    const total = roadmap['0_3M'].length + roadmap['3_6M'].length + roadmap['6_12M'].length
    expect(total).toBe(items.length)
  })

  it('roadmap selalu punya ketiga kunci horizon walau kosong', () => {
    const { roadmap } = recommend(resultFor('highest'), CAT)
    expect(Object.keys(roadmap).sort()).toEqual(['0_3M', '3_6M', '6_12M'])
  })

  it('kode di roadmap selalu ada di items', () => {
    const { items, roadmap } = recommend(resultFor('lowest'), CAT)
    const codes = new Set(items.map((x) => x.code))
    for (const h of ['0_3M', '3_6M', '6_12M'] as const) {
      for (const c of roadmap[h]) expect(codes.has(c)).toBe(true)
    }
  })
})

describe('determinisme rekomendasi', () => {
  it('dua panggilan menghasilkan urutan identik', () => {
    const r = resultFor('middle')
    expect(JSON.stringify(recommend(r, CAT))).toBe(JSON.stringify(recommend(r, CAT)))
  })

  it('urutan katalog tidak memengaruhi hasil', () => {
    const r = resultFor('lowest')
    const a = recommend(r, CAT)
    const b = recommend(r, [...CAT].reverse())
    expect(b.items.map((x) => x.code)).toEqual(a.items.map((x) => x.code))
  })
})

describe('relevansi: tidak menyarankan yang sudah dikerjakan', () => {
  it('tidak menyarankan kamus metrik pada perusahaan yang DAT-05 sudah sempurna', () => {
    const r = resultFor('highest')
    const dat05 = r.breakdown.find((b) => b.question_code === 'DAT-05')!
    expect(dat05.score).toBe(100)
    const codes = recommend(r, CAT).items.map((x) => x.code)
    expect(codes).not.toContain('REC-DAT-003')
  })

  it('tidak ada rekomendasi yang semua pemicunya sudah jauh di atas ambang', () => {
    for (const pick of ['highest', 'middle'] as const) {
      const r = resultFor(pick)
      const byQ = new Map(
        r.breakdown.filter((b) => b.visible && b.score !== null)
          .map((b) => [b.question_code, b.score!] as const),
      )
      for (const item of recommend(r, CAT).items) {
        const answered = item.triggers.filter((t) => byQ.has(t.question_code))
        if (answered.length === 0) continue
        const semuaTerpenuhi = answered.every((t) => byQ.get(t.question_code)! > t.max_score)
        expect({ profil: pick, code: item.code, semuaTerpenuhi })
          .toEqual({ profil: pick, code: item.code, semuaTerpenuhi: false })
      }
    }
  })

  it('pengisian minimum tetap memberi 3 walau kandidat relevannya sedikit', () => {
    expect(recommend(resultFor('highest'), CAT).items.length).toBeGreaterThanOrEqual(3)
  })
})

describe('roadmap berimbang antar horizon', () => {
  it('profil lemah tidak menumpuk semua rekomendasi di 0-3 bulan', () => {
    const { roadmap, items } = recommend(resultFor('lowest'), CAT)
    expect(items.length).toBe(10)
    expect(roadmap['0_3M'].length).toBeLessThan(items.length)
    expect(roadmap['3_6M'].length).toBeGreaterThan(0)
  })

  it('pekerjaan fondasi berdampak tinggi tidak tergusur quick win', () => {
    // REC-DAT-001 (impact 5, effort 4) adalah konsolidasi data: usaha besar,
    // tetapi justru inti kesiapan AI. Tidak boleh hilang dari daftar.
    const codes = recommend(resultFor('lowest'), CAT).items.map((x) => x.code)
    expect(codes).toContain('REC-DAT-001')
  })

  it('kuota horizon tidak melanggar batas maksimal', () => {
    const { items } = recommend(resultFor('lowest'), CAT, { max: 5 })
    expect(items.length).toBe(5)
  })

  it('tetap deterministik setelah kuota horizon diterapkan', () => {
    const r = resultFor('lowest')
    expect(recommend(r, CAT).items.map((x) => x.code))
      .toEqual(recommend(r, [...CAT].reverse()).items.map((x) => x.code))
  })
})

describe('integritas katalog', () => {
  it('setiap pemicu merujuk pertanyaan yang benar-benar ada', () => {
    const codes = new Set(QN.questions.map((q) => q.code))
    for (const item of CAT) {
      for (const t of item.triggers) {
        expect(codes.has(t.question_code)).toBe(true)
      }
    }
  })

  it('impact dan effort berada di rentang 1..5', () => {
    for (const item of CAT) {
      expect(item.impact).toBeGreaterThanOrEqual(1)
      expect(item.impact).toBeLessThanOrEqual(5)
      expect(item.effort).toBeGreaterThanOrEqual(1)
      expect(item.effort).toBeLessThanOrEqual(5)
    }
  })

  it('kode katalog unik', () => {
    expect(new Set(CAT.map((c) => c.code)).size).toBe(CAT.length)
  })

  it('setiap dimensi punya minimal satu rekomendasi agar pengisian minimum selalu bisa', () => {
    for (const d of QN.dimensions) {
      expect(CAT.some((c) => c.dimension_code === d.code)).toBe(true)
    }
  })

  it('setiap rekomendasi punya judul dan isi yang bermakna', () => {
    for (const item of CAT) {
      expect(item.title.length).toBeGreaterThan(10)
      expect(item.body.length).toBeGreaterThan(40)
      expect(item.owner_role.length).toBeGreaterThan(2)
    }
  })
})

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomValue(q: Question, rng: () => number): Answer['value'] {
  switch (q.type) {
    case 'single_choice': {
      const o = q.options ?? []
      return { choice: o[Math.floor(rng() * o.length)]!.code }
    }
    case 'multi_choice': {
      const o = q.options ?? []
      return { choices: o.filter(() => rng() > 0.5).map((x) => x.code) }
    }
    case 'scale_1_5': return { scale: 1 + Math.floor(rng() * 5) }
    case 'boolean': return { bool: rng() > 0.5 }
    case 'number': return { number: Math.floor(rng() * 100) }
    case 'text': return { text: '' }
  }
}
