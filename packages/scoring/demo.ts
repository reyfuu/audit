/**
 * Demo mesin skoring pada tiga profil bisnis nyata.
 * Jalankan: bun packages/scoring/demo.ts
 */
import {
  QUESTIONNAIRE_V1 as QN, RECOMMENDATION_CATALOG as CAT,
  recommend, score, type Answer,
} from './src'

const profil: Record<string, Record<string, Answer['value']>> = {
  'Toko retail 35 karyawan, masih spreadsheet': {
    'ORG-02': { choice: '10_49' },
    'STR-01': { choice: 'opt_25' }, 'STR-02': { choice: 'opt_50' }, 'STR-03': { choice: 'opt_25' },
    'STR-04': { choice: 'opt_25' }, 'STR-05': { choice: 'opt_0' }, 'STR-06': { scale: 3 },
    'DAT-01': { choice: 'opt_25' }, 'DAT-02': { choice: 'opt_25' }, 'DAT-03': { choice: 'opt_25' },
    'DAT-04': { choice: 'opt_25' }, 'DAT-05': { choice: 'opt_0' }, 'DAT-06': { choice: 'opt_0' },
    'DAT-07': { choices: ['sales_tx', 'customer'] }, 'DAT-08': { choice: 'opt_50' },
    'TEC-01': { choice: 'onprem_only' }, 'TEC-02': { choice: 'opt_25' }, 'TEC-03': { choice: 'opt_0' },
    'TEC-04': { choice: 'opt_0' }, 'TEC-05': { choice: 'opt_0' }, 'TEC-06': { bool: false },
    'TEC-07': { choice: 'opt_50' },
    'PPL-01': { choice: 'opt_25' }, 'PPL-02': { choice: 'opt_25' }, 'PPL-03': { choice: 'opt_0' },
    'PPL-04': { choice: 'opt_50' }, 'PPL-05': { choice: 'opt_25' }, 'PPL-06': { choice: 'opt_0' },
    'PRC-01': { choice: 'opt_25' }, 'PRC-02': { choice: 'opt_0' }, 'PRC-03': { choice: 'opt_25' },
    'PRC-05': { choice: 'opt_0' },
    'GOV-01': { choice: 'opt_0' }, 'GOV-02': { choice: 'opt_0' }, 'GOV-03': { choice: 'opt_0' },
    'GOV-04': { choice: 'opt_0' }, 'GOV-05': { bool: false }, 'GOV-06': { choice: 'opt_100' },
    'FIN-01': { choice: 'opt_50' }, 'FIN-02': { choice: 'opt_25' }, 'FIN-03': { choice: 'opt_50' },
    'FIN-04': { choice: 'opt_0' },
  },
  'Manufaktur 400 karyawan, ERP jalan, tata kelola lemah': {
    'ORG-02': { choice: '100_499' },
    'STR-01': { choice: 'opt_75' }, 'STR-02': { choice: 'opt_75' }, 'STR-03': { choice: 'opt_75' },
    'STR-04': { choice: 'opt_75' }, 'STR-05': { choice: 'opt_50' }, 'STR-06': { scale: 4 },
    'DAT-01': { choice: 'opt_75' }, 'DAT-02': { choice: 'opt_100' }, 'DAT-03': { choice: 'opt_75' },
    'DAT-04': { choice: 'opt_50' }, 'DAT-05': { choice: 'opt_50' }, 'DAT-06': { choice: 'opt_50' },
    'DAT-07': { choices: ['sales_tx', 'customer', 'inventory', 'finance', 'ops', 'sensor'] },
    'DAT-08': { choice: 'opt_50' },
    'TEC-01': { choice: 'hybrid' }, 'TEC-02': { choice: 'opt_75' }, 'TEC-03': { choice: 'opt_50' },
    'TEC-04': { choice: 'opt_100' }, 'TEC-05': { choice: 'opt_50' }, 'TEC-06': { bool: true },
    'TEC-07': { choice: 'opt_50' },
    'PPL-01': { choice: 'opt_75' }, 'PPL-02': { choice: 'opt_75' }, 'PPL-03': { choice: 'opt_50' },
    'PPL-04': { choice: 'opt_50' }, 'PPL-05': { choice: 'opt_50' }, 'PPL-06': { choice: 'opt_100' },
    'PPL-07': { choice: 'opt_50' },
    'PRC-01': { choice: 'opt_75' }, 'PRC-02': { choice: 'opt_50' }, 'PRC-03': { choice: 'opt_75' },
    'PRC-05': { choice: 'opt_50' },
    'GOV-01': { choice: 'opt_0' }, 'GOV-02': { choice: 'opt_25' }, 'GOV-03': { choice: 'opt_0' },
    'GOV-04': { choice: 'opt_0' }, 'GOV-05': { bool: false }, 'GOV-06': { choice: 'opt_0' },
    'FIN-01': { choice: 'opt_100' }, 'FIN-02': { choice: 'opt_75' }, 'FIN-03': { choice: 'opt_100' },
    'FIN-04': { choice: 'opt_50' },
  },
  'Fintech 150 karyawan, cloud-native, siap': {
    'ORG-02': { choice: '100_499' },
    'STR-01': { choice: 'opt_100' }, 'STR-02': { choice: 'opt_100' }, 'STR-03': { choice: 'opt_100' },
    'STR-04': { choice: 'opt_100' }, 'STR-05': { choice: 'opt_100' }, 'STR-06': { scale: 5 },
    'DAT-01': { choice: 'opt_100' }, 'DAT-02': { choice: 'opt_100' }, 'DAT-03': { choice: 'opt_75' },
    'DAT-04': { choice: 'opt_100' }, 'DAT-05': { choice: 'opt_100' }, 'DAT-06': { choice: 'opt_100' },
    'DAT-07': { choices: ['sales_tx', 'customer', 'finance', 'ops', 'text_docs'] },
    'DAT-08': { choice: 'opt_100' },
    'TEC-01': { choice: 'cloud_native' }, 'TEC-02': { choice: 'opt_100' }, 'TEC-03': { choice: 'opt_100' },
    'TEC-05': { choice: 'opt_100' }, 'TEC-06': { bool: true }, 'TEC-07': { choice: 'opt_100' },
    'PPL-01': { choice: 'opt_100' }, 'PPL-02': { choice: 'opt_100' }, 'PPL-03': { choice: 'opt_100' },
    'PPL-04': { choice: 'opt_100' }, 'PPL-05': { choice: 'opt_100' }, 'PPL-06': { choice: 'opt_100' },
    'PPL-07': { choice: 'opt_100' },
    'PRC-01': { choice: 'opt_75' }, 'PRC-02': { choice: 'opt_100' }, 'PRC-03': { choice: 'opt_75' },
    'PRC-05': { choice: 'opt_100' },
    'GOV-01': { choice: 'opt_100' }, 'GOV-02': { choice: 'opt_100' }, 'GOV-03': { choice: 'opt_100' },
    'GOV-04': { choice: 'opt_100' }, 'GOV-05': { bool: true }, 'GOV-06': { choice: 'opt_50' },
    'FIN-01': { choice: 'opt_100' }, 'FIN-02': { choice: 'opt_100' }, 'FIN-03': { choice: 'opt_100' },
    'FIN-04': { choice: 'opt_100' },
  },
}

const bar = (n: number) => '▰'.repeat(Math.round(n / 10)).padEnd(10, '▱')

for (const [nama, jawaban] of Object.entries(profil)) {
  const answers: Answer[] = Object.entries(jawaban).map(([code, value]) => ({
    question_code: code, value,
  }))
  const r = score({ answers, questionnaire: QN })
  const { items, roadmap } = recommend(r, CAT)

  console.log(`\n${'═'.repeat(66)}`)
  console.log(nama)
  console.log('═'.repeat(66))
  console.log(`VERDICT: ${r.verdict}   Skor ${r.total_score}/100   Level ${r.level}   Keyakinan ${r.confidence}`)
  for (const g of r.gates.filter((x) => x.triggered)) console.log(`  ⚠ ${g.code}: ${g.message}`)
  console.log()
  for (const d of r.dimensions) {
    console.log(`  ${d.name.padEnd(26)} ${String(d.score).padStart(5)}  L${d.level}  ${bar(d.score)}`)
  }
  console.log(`\n  Langkah prioritas (${items.length} rekomendasi):`)
  for (const it of items.slice(0, 3)) {
    console.log(`   ${it.rank}. ${it.title}`)
    console.log(`      dampak ${it.impact}/5 · usaha ${it.effort}/5 · ${it.horizon} · ${it.owner_role} · ${it.cost_band}`)
  }
  console.log(`  Roadmap: 0-3bln ${roadmap['0_3M'].length} · 3-6bln ${roadmap['3_6M'].length} · 6-12bln ${roadmap['6_12M'].length}`)

  const quick = score({ answers, questionnaire: QN, mode: 'QUICK' })
  console.log(`  Quick Check memberi ${quick.total_score} (${quick.verdict}), selisih ${Math.abs(quick.total_score - r.total_score).toFixed(1)} dari audit penuh`)
}
console.log()
