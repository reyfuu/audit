import type { Config } from 'drizzle-kit'

export default {
  schema: './apps/api/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/siapai_dev',
  },
} satisfies Config
