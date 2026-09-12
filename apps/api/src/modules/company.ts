/** Modul perusahaan klien (FR-05, FR-06). Jalur auditor. */
import { Elysia, t } from 'elysia'
import { err } from '../lib/errors'
import { authGuard } from '../lib/guards'
import type { Repo } from '../lib/repo'
import * as S from '../lib/schemas'

export function companyModule({ repo }: { repo: Repo }) {
  return new Elysia({ prefix: '/companies' })
    .use(authGuard)
    .post(
      '/',
      async ({ body, user, status }) => {
        const row = await repo.createCompany({
          owner_auditor_id: user!.id,
          name: body.name,
          industry: body.industry,
          employee_band: body.employee_band,
          ...(body.revenue_band ? { revenue_band: body.revenue_band } : {}),
          country: body.country ?? 'ID',
          ...(body.province ? { province: body.province } : {}),
        })
        return status(201, row)
      },
      {
        body: S.CompanyInput,
        response: { 201: S.Company, 401: S.ErrorEnvelope },
        detail: { tags: ['Companies'], summary: 'Daftarkan perusahaan klien' },
      },
    )
    .get(
      '/',
      async ({ user }) => ({ items: await repo.listCompanies(user!.id) }),
      {
        response: { 200: t.Object({ items: t.Array(S.Company) }), 401: S.ErrorEnvelope },
        detail: { tags: ['Companies'], summary: 'Daftar perusahaan klien milik auditor' },
      },
    )
    .get(
      '/:id',
      async ({ params, user, status }) => {
        // FR-06: milik auditor lain dianggap tidak ada, bukan terlarang.
        const c = await repo.getCompany(params.id, user!.id)
        if (!c) return status(404, err('NOT_FOUND', 'Perusahaan tidak ditemukan'))
        return c
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 200: S.Company, 401: S.ErrorEnvelope, 404: S.ErrorEnvelope },
        detail: { tags: ['Companies'], summary: 'Detail perusahaan klien' },
      },
    )
}
