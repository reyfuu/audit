/** Entry point web: halaman masuk, dashboard auditor, dan form responden. */
import { createWebApp } from './app'

const API = process.env.API_BASE_URL ?? 'http://localhost:3001'
const port = Number(process.env.PORT ?? 3000)
const publicBase = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`

createWebApp({
  raw: (path, init = {}, token) => fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }),
  publicBase,
}).listen(port)

console.log(`SiapAI berjalan di ${publicBase}`)
