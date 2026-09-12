/**
 * Entry point API.
 *
 * Penyimpanan mengikuti DATABASE_URL: Postgres bila ada, memori bila tidak.
 * Tanpa ini, API produksi akan diam-diam berjalan di atas memori dan seluruh
 * data hilang setiap kali proses direstart.
 */
import { createApp } from './app'
import { createStorage } from './db'

const port = Number(process.env.PORT ?? 3001)
const storage = createStorage()
const { app } = createApp({ repo: storage.repo })
app.listen(port)

console.log(`SiapAI API berjalan di http://localhost:${port} (penyimpanan: ${storage.kind})`)
