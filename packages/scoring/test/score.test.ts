/**
 * Uji mesin skoring. Tiap test dipetakan ke business rule di FRD §5.
 */
import { describe, it, expect } from 'bun:test'
import {
  QUESTIONNAIRE_V1, RECOMMENDATION_CATALOG, baseVerdict, confidenceOf, levelOf,
  missingRequired, recommend, round, score, scoreAnswer, visibleQuestions,
  type Answer, type Question, type Questionnaire,
} from '../src'

// ── Helper: bangun jawaban lengkap dengan memilih opsi ke-n dari tiap pertanyaan
type Pick = 'lowest' | 'highest' | 'middle'

function answerAll(qn: Questionnaire, pick: Pick, overrides: Answer[] = []): Answer[] {
  const base: Answer[] = []
  for (const q of qn.questions) {
    if (q.type === 'text') continue
    base.push({ question_code: q.code, value: valueFor(q, pick) })
  }
  const byCode = new Map(base.map((a) => [a.question_code, a]))
  for (const o of overrides) byCode.set(o.question_code, o)
  return [...byCode.values()]
}

function valueFor(q: Question, pick: Pick): Answer['value'] {
  switch (q.type) {
    case 'single_choice': {
      const o = q.options ?? []
      const sorted = [...o].sort((a, b) => a.score - b.score)
      const chosen = pick === 'lowest' ? sorted[0]
        : pick === 'highest' ? sorted[sorted.length - 1]
        : sorted[Math.floor(sorted.length / 2)]
      return { choice: chosen!.code }
    }
    case 'multi_choice': {
      const o = q.options ?? []
      if (pick === 'lowest') return { choices: [] }
      if (pick === 'highest') return { choices: o.map((x) => x.code) }
      return { choices: o.slice(0, Math.ceil(o.length / 2)).map((x) => x.code) }
    }
    case 'scale_1_5':
      return { scale: pick === 'lowest' ? 1 : pick === 'highest' ? 5 : 3 }
    case 'boolean':
      return { bool: pick === 'highest' }
    case 'number':
      return { number: pick === 'lowest' ? (q.min ?? 0) : (q.max ?? 100) }
    case 'text':
      return { text: '' }
  }
}

const QN = QUESTIONNAIRE_V1

describe('BR-01 skor jawaban per tipe', () => {
  it('single_choice memakai skor opsi', () => {
    const q = QN.questions.find((x) => x.code === 'DAT-01')!
    expect(scoreAnswer(q, { choice: 'opt_0' })).toBe(0)
    expect(scoreAnswer(q, { choice: 'opt_100' })).toBe(100)
  })

  it('single_choice dengan opsi tidak dikenal -> null (tidak diam-diam nol)', () => {
    const q = QN.questions.find((x) => x.code === 'DAT-01')!
    expect(scoreAnswer(q, { choice: 'opt_tidak_ada' })).toBeNull()
  })

  it('scale_1_5 dipetakan linear 1->0 dan 5->100', () => {
    const q = QN.questions.find((x) => x.code === 'STR-06')!
    expect(scoreAnswer(q, { scale: 1 })).toBe(0)
    expect(scoreAnswer(q, { scale: 3 })).toBe(50)
    expect(scoreAnswer(q, { scale: 5 })).toBe(100)
  })

  it('scale_1_5 di luar rentang -> null', () => {
    const q = QN.questions.find((x) => x.code === 'STR-06')!
    expect(scoreAnswer(q, { scale: 0 })).toBeNull()
    expect(scoreAnswer(q, { scale: 6 })).toBeNull()
    expect(scoreAnswer(q, { scale: 2.5 })).toBeNull()
  })

  it('boolean: true=100, false=0', () => {
    const q = QN.questions.find((x) => x.code === 'TEC-06')!
    expect(scoreAnswer(q, { bool: true })).toBe(100)
    expect(scoreAnswer(q, { bool: false })).toBe(0)
  })

  it('multi_choice inventaris diskor proporsional jumlah yang dipilih', () => {
    const q = QN.questions.find((x) => x.code === 'DAT-07')!
    const all = q.options!.map((o) => o.code)
    expect(scoreAnswer(q, { choices: [] })).toBe(0)
    expect(scoreAnswer(q, { choices: all })).toBe(100)
    expect(scoreAnswer(q, { choices: all.slice(0, 4) })).toBe(50)
  })

  it('tipe nilai tidak cocok dengan tipe pertanyaan -> null', () => {
    const q = QN.questions.find((x) => x.code === 'DAT-01')!
    expect(scoreAnswer(q, { scale: 3 })).toBeNull()
    expect(scoreAnswer(q, { bool: true })).toBeNull()
  })
})

describe('BR-04 level maturitas', () => {
  it('batas tiap level tepat sesuai FRD', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(19.9)).toBe(1)
    expect(levelOf(20)).toBe(2)
    expect(levelOf(39.9)).toBe(2)
    expect(levelOf(40)).toBe(3)
    expect(levelOf(59.9)).toBe(3)
    expect(levelOf(60)).toBe(4)
    expect(levelOf(79.9)).toBe(4)
    expect(levelOf(80)).toBe(5)
    expect(levelOf(100)).toBe(5)
  })
})

describe('BR-05 verdict', () => {
  it('batas verdict tepat sesuai FRD', () => {
    expect(baseVerdict(49.9)).toBe('NOT_READY')
    expect(baseVerdict(50)).toBe('CONDITIONALLY_READY')
    expect(baseVerdict(69.9)).toBe('CONDITIONALLY_READY')
    expect(baseVerdict(70)).toBe('READY')
  })
})

describe('BR-03 skor total', () => {
  it('semua jawaban terbaik menghasilkan 100 dan verdict READY', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN })
    expect(r.total_score).toBe(100)
    expect(r.level).toBe(5)
    expect(r.verdict).toBe('READY')
  })

  it('semua jawaban terburuk menghasilkan 0 dan verdict NOT_READY', () => {
    const r = score({ answers: answerAll(QN, 'lowest'), questionnaire: QN })
    expect(r.total_score).toBe(0)
    expect(r.level).toBe(1)
    expect(r.verdict).toBe('NOT_READY')
  })

  it('skor total selalu berada dalam 0..100', () => {
    for (const pick of ['lowest', 'middle', 'highest'] as const) {
      const r = score({ answers: answerAll(QN, pick), questionnaire: QN })
      expect(r.total_score).toBeGreaterThanOrEqual(0)
      expect(r.total_score).toBeLessThanOrEqual(100)
    }
  })

  it('bobot 7 dimensi berjumlah 1.0', () => {
    const sum = QN.dimensions.reduce((a, d) => a + d.weight, 0)
    expect(round(sum, 6)).toBe(1)
  })
})

describe('BR-02 pertanyaan tidak visible tidak menghukum skor', () => {
  it('PPL-07 dikecualikan untuk perusahaan kecil', () => {
    const kecil = answerAll(QN, 'highest', [
      { question_code: 'ORG-02', value: { choice: '10_49' } },
    ])
    const r = score({ answers: kecil, questionnaire: QN })
    const ppl07 = r.breakdown.find((b) => b.question_code === 'PPL-07')!
    expect(ppl07.visible).toBe(false)
    // Meski PPL-07 tidak dihitung, dimensi PPL tetap 100 karena sisanya sempurna.
    expect(r.dimensions.find((d) => d.dimension_code === 'PPL')!.score).toBe(100)
  })

  it('pertanyaan tak-visible yang tidak dijawab tidak menurunkan skor', () => {
    const besar = answerAll(QN, 'highest', [
      { question_code: 'ORG-02', value: { choice: '1000_plus' } },
    ])
    const kecil = besar.filter((a) => a.question_code !== 'PPL-07')
      .map((a) => a.question_code === 'ORG-02' ? { ...a, value: { choice: '10_49' } } : a)
    const rBesar = score({ answers: besar, questionnaire: QN })
    const rKecil = score({ answers: kecil, questionnaire: QN })
    expect(rKecil.dimensions.find((d) => d.dimension_code === 'PPL')!.score)
      .toBe(rBesar.dimensions.find((d) => d.dimension_code === 'PPL')!.score)
  })

  it('TEC-04 hanya tampil bila masih ada komponen on-premise', () => {
    const cloud = answerAll(QN, 'middle', [
      { question_code: 'TEC-01', value: { choice: 'cloud_native' } },
    ])
    const onprem = answerAll(QN, 'middle', [
      { question_code: 'TEC-01', value: { choice: 'onprem_only' } },
    ])
    const vCloud = visibleQuestions(cloud, QN).map((x) => x.code)
    const vOnprem = visibleQuestions(onprem, QN).map((x) => x.code)
    expect(vCloud).not.toContain('TEC-04')
    expect(vOnprem).toContain('TEC-04')
  })
})

describe('BR-06 & BR-07 hard gate', () => {
  it('BR-06: DAT < 40 memaksa NOT_READY walau skor total tinggi', () => {
    const answers = answerAll(QN, 'highest')
    // Turunkan semua pertanyaan DAT berskor ke nilai terendah.
    const datQuestions = QN.questions.filter(
      (x) => x.dimension_code === 'DAT' && !x.unscored && x.type !== 'text')
    const withWeakData = answerAll(QN, 'highest',
      datQuestions.map((x) => ({ question_code: x.code, value: valueFor(x, 'lowest') })))

    const strong = score({ answers, questionnaire: QN })
    const weak = score({ answers: withWeakData, questionnaire: QN })

    expect(strong.verdict).toBe('READY')
    expect(weak.dimensions.find((d) => d.dimension_code === 'DAT')!.score).toBeLessThan(40)
    expect(weak.gates.find((g) => g.code === 'DATA_FOUNDATION_GATE')!.triggered).toBe(true)
    expect(weak.verdict).toBe('NOT_READY')
    // Total masih tinggi: gate-lah yang menurunkan verdict, bukan skornya.
    expect(weak.total_score).toBeGreaterThan(50)
  })

  it('BR-07: GOV < 30 membatasi verdict maksimal CONDITIONALLY_READY', () => {
    const govQuestions = QN.questions.filter(
      (x) => x.dimension_code === 'GOV' && !x.unscored && x.type !== 'text')
    const answers = answerAll(QN, 'highest',
      govQuestions.map((x) => ({ question_code: x.code, value: valueFor(x, 'lowest') })))
    const r = score({ answers, questionnaire: QN })
    expect(r.dimensions.find((d) => d.dimension_code === 'GOV')!.score).toBeLessThan(30)
    expect(r.gates.find((g) => g.code === 'GOVERNANCE_GATE')!.triggered).toBe(true)
    expect(r.verdict).toBe('CONDITIONALLY_READY')
  })

  it('gate tidak pernah menaikkan verdict', () => {
    const r = score({ answers: answerAll(QN, 'lowest'), questionnaire: QN })
    expect(r.verdict).toBe('NOT_READY')
  })

  it('tanpa gate terpicu, verdict sama dengan baseVerdict(total)', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN })
    expect(r.gates.every((g) => !g.triggered)).toBe(true)
    expect(r.verdict).toBe(baseVerdict(r.total_score))
  })
})

describe('BR-08 determinisme (property test)', () => {
  it('input identik selalu menghasilkan output identik, 200 percobaan acak', () => {
    const rng = mulberry32(12345)
    for (let i = 0; i < 200; i++) {
      const answers = randomAnswers(QN, rng)
      const a = score({ answers, questionnaire: QN })
      const b = score({ answers: [...answers].reverse(), questionnaire: QN })
      // Urutan array jawaban tidak boleh memengaruhi hasil.
      expect(b.total_score).toBe(a.total_score)
      expect(b.verdict).toBe(a.verdict)
      expect(JSON.stringify(sortBreakdown(b))).toBe(JSON.stringify(sortBreakdown(a)))
    }
  })

  it('tidak memakai sumber non-deterministik: dua panggilan berurutan identik', () => {
    const answers = answerAll(QN, 'middle')
    const a = JSON.stringify(score({ answers, questionnaire: QN }))
    const b = JSON.stringify(score({ answers, questionnaire: QN }))
    expect(a).toBe(b)
  })
})

describe('TRD §5 monotonicity (property test)', () => {
  it('menaikkan satu jawaban tidak pernah menurunkan skor dimensinya', () => {
    const rng = mulberry32(999)
    const scored = QN.questions.filter((x) => !x.unscored && x.type === 'single_choice')
    for (let i = 0; i < 150; i++) {
      const answers = randomAnswers(QN, rng)
      const target = scored[Math.floor(rng() * scored.length)]!
      const options = [...(target.options ?? [])].sort((a, b) => a.score - b.score)
      if (options.length < 2) continue

      const before = score({
        answers: upsert(answers, target.code, { choice: options[0]!.code }),
        questionnaire: QN,
      })
      const after = score({
        answers: upsert(answers, target.code, { choice: options[options.length - 1]!.code }),
        questionnaire: QN,
      })
      const dim = target.dimension_code
      const sBefore = before.dimensions.find((d) => d.dimension_code === dim)!.score
      const sAfter = after.dimensions.find((d) => d.dimension_code === dim)!.score
      expect(sAfter).toBeGreaterThanOrEqual(sBefore)
    }
  })
})

describe('BR-09 confidence', () => {
  it('tanpa bukti -> LOW', () => {
    const r = score({ answers: answerAll(QN, 'middle'), questionnaire: QN })
    expect(r.confidence).toBe('LOW')
  })

  it('semua jawaban berbukti -> HIGH', () => {
    const answers = answerAll(QN, 'middle').map((a) => ({ ...a, evidence_url: 'https://x.id/a.pdf' }))
    const r = score({ answers, questionnaire: QN })
    expect(r.confidence).toBe('HIGH')
  })

  it('mode QUICK selalu LOW apa pun buktinya', () => {
    const answers = answerAll(QN, 'highest').map((a) => ({ ...a, evidence_url: 'https://x.id/a.pdf' }))
    const r = score({ answers, questionnaire: QN, mode: 'QUICK' })
    expect(r.confidence).toBe('LOW')
  })

  it('breakdown kosong -> LOW, bukan crash', () => {
    expect(confidenceOf([], 'FULL')).toBe('LOW')
  })
})

describe('mode QUICK: ringkasan cepat dari pertanyaan inti', () => {
  it('hanya menghitung pertanyaan yang ditandai inti', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN, mode: 'QUICK' })
    const expected = QN.questions.filter((x) => x.in_quick_check).length
    expect(r.breakdown.length).toBe(expected)
    // QUESTION_BANK: 13 pertanyaan inti berskor, ditambah profil ORG-02 & ORG-03
    // menjadi 15 pertanyaan pembuka form. Dipakai untuk ringkasan progres di
    // dashboard auditor ketika responden berhenti di tengah (BRD v2), bukan
    // sebagai produk gratis terpisah.
    expect(expected).toBe(13)
  })

  it('daftar pertanyaan inti persis sama dengan QUESTION_BANK.md', () => {
    const actual = QN.questions.filter((x) => x.in_quick_check).map((x) => x.code).sort()
    expect(actual).toEqual([
      'DAT-01', 'DAT-02', 'DAT-03', 'DAT-04', 'FIN-02', 'GOV-01', 'PPL-01',
      'PPL-02', 'PRC-01', 'STR-01', 'STR-02', 'TEC-01', 'TEC-02',
    ])
  })

  it('QUICK tetap menghasilkan skor dan verdict yang valid', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN, mode: 'QUICK' })
    expect(r.total_score).toBe(100)
    expect(r.verdict).toBe('READY')
  })

  it('QUICK menormalisasi bobot: dimensi tanpa pertanyaan tidak menyeret skor ke bawah', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN, mode: 'QUICK' })
    const kosong = r.dimensions.filter((d) => d.counted_questions === 0)
    // Dimensi tanpa pertanyaan quick check tetap 0, tetapi tidak menurunkan total.
    expect(r.total_score).toBe(100)
    expect(kosong.every((d) => d.score === 0)).toBe(true)
  })
})

describe('FR-12 AC1 deteksi jawaban wajib yang kurang', () => {
  it('jawaban lengkap -> tidak ada yang kurang', () => {
    expect(missingRequired(answerAll(QN, 'middle'), QN)).toEqual([])
  })

  it('melaporkan kode pertanyaan yang kosong', () => {
    const answers = answerAll(QN, 'middle').filter(
      (a) => a.question_code !== 'DAT-03' && a.question_code !== 'GOV-02')
    const missing = missingRequired(answers, QN)
    expect(missing).toContain('DAT-03')
    expect(missing).toContain('GOV-02')
    expect(missing).toHaveLength(2)
  })

  it('tidak menuntut pertanyaan yang sedang tidak visible', () => {
    const kecil = answerAll(QN, 'middle', [
      { question_code: 'ORG-02', value: { choice: '10_49' } },
    ]).filter((a) => a.question_code !== 'PPL-07')
    expect(missingRequired(kecil, QN)).not.toContain('PPL-07')
  })

  it('jawaban dengan opsi tidak valid dihitung sebagai belum terjawab', () => {
    const answers = answerAll(QN, 'middle').map((a) =>
      a.question_code === 'DAT-01' ? { ...a, value: { choice: 'ngawur' } } : a)
    expect(missingRequired(answers, QN)).toContain('DAT-01')
  })
})

describe('kasus tepi', () => {
  it('tanpa jawaban sama sekali tidak crash dan menghasilkan 0', () => {
    const r = score({ answers: [], questionnaire: QN })
    expect(r.total_score).toBe(0)
    expect(r.verdict).toBe('NOT_READY')
    expect(r.dimensions).toHaveLength(7)
  })

  it('jawaban untuk pertanyaan yang tidak ada di kuesioner diabaikan', () => {
    const answers = [...answerAll(QN, 'highest'),
      { question_code: 'TIDAK-ADA', value: { choice: 'x' } } as Answer]
    const r = score({ answers, questionnaire: QN })
    expect(r.total_score).toBe(100)
  })

  it('pertanyaan unscored tidak masuk breakdown', () => {
    const r = score({ answers: answerAll(QN, 'highest'), questionnaire: QN })
    expect(r.breakdown.find((b) => b.question_code === 'ORG-02')).toBeUndefined()
    expect(r.breakdown.find((b) => b.question_code === 'PRC-04')).toBeUndefined()
  })

  it('rubric_version ikut tersimpan di hasil (PA4)', () => {
    const r = score({ answers: answerAll(QN, 'middle'), questionnaire: QN })
    expect(r.rubric_version).toBe('1.0.0')
  })

  it('round memakai half-up, bukan pembulatan biner yang mengejutkan', () => {
    expect(round(1.05, 1)).toBe(1.1)
    expect(round(2.675, 2)).toBe(2.68)
    expect(round(58.35, 1)).toBe(58.4)
  })
})

// ── Helper property test
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomAnswers(qn: Questionnaire, rng: () => number): Answer[] {
  const out: Answer[] = []
  for (const q of qn.questions) {
    if (q.type === 'text') continue
    if (rng() < 0.1) continue // kadang tidak dijawab
    out.push({ question_code: q.code, value: randomValue(q, rng) })
  }
  return out
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
    case 'scale_1_5':
      return { scale: 1 + Math.floor(rng() * 5) }
    case 'boolean':
      return { bool: rng() > 0.5 }
    case 'number':
      return { number: Math.floor(rng() * 100) }
    case 'text':
      return { text: '' }
  }
}

function upsert(answers: Answer[], code: string, value: Answer['value']): Answer[] {
  return [...answers.filter((a) => a.question_code !== code), { question_code: code, value }]
}

function sortBreakdown(r: ReturnType<typeof score>) {
  return [...r.breakdown].sort((a, b) => a.question_code.localeCompare(b.question_code))
}
