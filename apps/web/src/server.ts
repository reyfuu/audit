/** Entry point web responden. */
import { createWeb } from './web'

const API = process.env.API_BASE_URL ?? 'http://localhost:3001'
const port = Number(process.env.PORT ?? 3000)

createWeb({
  api: (path, init) => fetch(`${API}${path}`, init),
}).listen(port)

console.log(`SiapAI form berjalan di http://localhost:${port}`)
