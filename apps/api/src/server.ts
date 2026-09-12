/** Entry point API. */
import { createApp } from './app'

const port = Number(process.env.PORT ?? 3001)
const { app } = createApp()
app.listen(port)
console.log(`SiapAI API berjalan di http://localhost:${port}`)
