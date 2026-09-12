/**
 * Mengaktifkan token pengembangan untuk uji.
 *
 * Uji alur bisnis memakai `Bearer user:<id>` agar tidak perlu menjalankan
 * login OTP penuh di setiap kasus. Jalur ini mati secara default dan tidak
 * pernah aktif di produksi; lihat `devTokensAllowed` di lib/guards.ts.
 */
process.env.ALLOW_DEV_TOKENS = '1'
