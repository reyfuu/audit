/**
 * Pemilihan penyimpanan.
 *
 * Bila DATABASE_URL ada, pakai Postgres. Bila tidak, pakai memori agar
 * demo dan uji tetap dapat berjalan tanpa menyiapkan basis data.
 */
import { createMemoryRepo, type Repo } from '../lib/repo'
import { createDb, createPgRepo } from './pg-repo'

export interface Storage {
  repo: Repo
  kind: 'postgres' | 'memory'
  close: () => Promise<void>
}

export function createStorage(url = process.env.DATABASE_URL): Storage {
  if (!url) {
    return { repo: createMemoryRepo(), kind: 'memory', close: async () => {} }
  }
  const { db, client } = createDb(url)
  return { repo: createPgRepo(db), kind: 'postgres', close: () => client.end() }
}

export { createDb, createPgRepo } from './pg-repo'
export * as schema from './schema'
