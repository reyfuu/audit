import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { app } from './app'
const docs = new Elysia().use(openapi()).use(app)
await docs.modules
const r = await docs.handle(new Request('http://localhost/openapi/json'))
const spec = await r.json()
console.log('openapi version:', spec.openapi)
const op = spec.paths?.['/assessments/{id}/answers']?.patch
console.log('responses:', Object.keys(op?.responses ?? {}))
