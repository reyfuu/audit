/**
 * Entry point produksi: API dan web dalam satu proses.
 *
 * Keduanya disatukan karena web memang hanya berbicara ke API ini dan tidak
 * ada pemakai lain. Satu proses berarti satu unit yang dijalankan, dipantau,
 * dan direstart, tanpa lompatan jaringan yang tidak perlu di antara keduanya.
 *
 * Jalankan: PUBLIC_BASE_URL=https://... DATABASE_URL=postgres://... bun apps/web/src/produksi.ts
 */
import { aiConfigFromEnv, createChatClient } from '@siapai/ai'
import { createApp } from '../../api/src/app'
import { createStorage } from '../../api/src/db'
import { createWebApp } from './app'

const PORT = Number(process.env.PORT ?? 3000)
const API_PORT = Number(process.env.API_PORT ?? 3001)
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`

if (!process.env.AUTH_SECRET && process.env.NODE_ENV === 'production') {
  // Tanpa ini, token akan ditandatangani memakai kunci pengembangan yang
  // diketahui umum. Lebih baik gagal menyala daripada berjalan tidak aman.
  console.error('AUTH_SECRET wajib disetel di produksi')
  process.exit(1)
}

const storage = createStorage()
const aiCfg = aiConfigFromEnv()

const { app: api } = createApp({
  repo: storage.repo,
  baseUrl: PUBLIC_BASE,
  ...(aiCfg ? { chat: createChatClient(aiCfg) } : {}),
  renderPdf: async (url: string) => {
    const { renderPdf } = await import('../../api/src/lib/pdf')
    return renderPdf(url)
  },
})
api.listen(API_PORT)

/**
 * Web memanggil API lewat handler in-process, bukan lewat jaringan.
 * Selain lebih cepat, ini menutup kemungkinan port API tersentuh dari luar.
 */
createWebApp({
  raw: (path, init = {}, token) =>
    api.handle(new Request(`http://127.0.0.1:${API_PORT}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })),
  publicBase: PUBLIC_BASE,
}).listen(PORT)

console.log([
  `SiapAI berjalan di ${PUBLIC_BASE}`,
  `  port        : ${PORT}`,
  `  penyimpanan : ${storage.kind}`,
  `  tinjauan AI : ${aiCfg ? `aktif (${aiCfg.model})` : 'nonaktif (AI_API_KEY belum disetel)'}`,
].join('\n'))
