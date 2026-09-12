/**
 * Komposisi aplikasi web: halaman masuk, dashboard auditor, dan form responden.
 *
 * Dirakit di satu tempat agar demo, uji, dan produksi menjalankan susunan yang
 * persis sama; perbedaan hanya pada cara memanggil API.
 */
import { Elysia } from 'elysia'
import { akunModule } from './akun'
import { auditorModule } from './auditor'
import type { RawApi } from './auth-guard'
import { loginModule } from './login'
import { createWeb } from './web'
import { sessionApi, secureDari } from './auth-guard'

export interface WebAppDeps {
  /** Pemanggil API; token sesi disuntikkan per permintaan bila ada. */
  raw: RawApi
  publicBase: string
}

export function createWebApp({ raw, publicBase }: WebAppDeps) {
  return new Elysia()
    // Akar adalah halaman masuk; modul login yang memutuskan apakah pengunjung
    // perlu masuk atau langsung diteruskan ke dashboard.
    .use(loginModule({ raw, publicBase }))
    .use(akunModule({ raw, publicBase }))
    .use(auditorModule({ raw, publicBase }))
    .use(createWeb({
      api: (path, init) => raw(path, init),
      // Laporan dibuka oleh responden, publik, dan auditor. Hanya yang terakhir
      // yang boleh melihat jalan kembali ke dashboard.
      adaSesiAuditor: async (cookie) =>
        (await sessionApi(raw, cookie, secureDari(publicBase))) !== null,
    }))
}
