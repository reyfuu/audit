/**
 * Set ikon SVG inline.
 *
 * Sebelumnya navigasi memakai campuran emoji dan simbol Unicode. Itu bermasalah
 * karena tiga hal: bentuknya berbeda-beda antar sistem operasi, emoji berwarna
 * bertabrakan dengan simbol monokrom di baris yang sama, dan sebagian simbol
 * menyesatkan (☰ berarti "menu", bukan "akun").
 *
 * SVG inline menyelesaikan ketiganya tanpa menambah dependensi atau permintaan
 * jaringan: bentuknya pasti sama di mana pun, mewarisi warna teks lewat
 * `currentColor`, dan tetap tajam pada layar kepadatan tinggi.
 *
 * Semua ikon memakai grid 24x24, garis 1.8px, ujung membulat: satu bahasa visual
 * agar tidak ada ikon yang terlihat lebih berat daripada tetangganya.
 */
const svg = (isi: string, ukuran = 20): string =>
  `<svg class="icon" width="${ukuran}" height="${ukuran}" viewBox="0 0 24 24" fill="none"
   stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
   aria-hidden="true" focusable="false">${isi}</svg>`

export const ICONS = {
  /** Ringkasan: panel ikhtisar. */
  ringkasan: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/>'
    + '<rect x="14" y="3" width="7" height="5" rx="1.5"/>'
    + '<rect x="14" y="12" width="7" height="9" rx="1.5"/>'
    + '<rect x="3" y="16" width="7" height="5" rx="1.5"/>'),

  /** Undangan: amplop terkirim. */
  undangan: svg('<rect x="2.5" y="5" width="19" height="14" rx="2"/>'
    + '<path d="m3 7 8.1 5.4a2 2 0 0 0 2.2 0L21 7"/>'),

  /** Perusahaan: gedung dengan jendela. */
  perusahaan: svg('<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/>'
    + '<path d="M15 21V11h3a2 2 0 0 1 2 2v8"/>'
    + '<path d="M8 7h1.5M8 11h1.5M8 15h1.5M12 7h.5M12 11h.5M12 15h.5"/>'),

  /** Tinjauan AI: percikan, lazim dipakai untuk fitur berbasis model. */
  tinjauan: svg('<path d="M12 3.5 13.6 8a4 4 0 0 0 2.4 2.4L20.5 12l-4.5 1.6A4 4 0 0 0 13.6 16L12 20.5 10.4 16A4 4 0 0 0 8 13.6L3.5 12 8 10.4A4 4 0 0 0 10.4 8z"/>'
    + '<path d="M18.5 3v3M20 4.5h-3"/>'),

  /** Akun & tim: dua orang, bukan garis menu yang menyesatkan. */
  akun: svg('<circle cx="9" cy="8" r="3.2"/>'
    + '<path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/>'
    + '<path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.9"/>'
    + '<path d="M18 14.4A5.5 5.5 0 0 1 21.4 20"/>'),

  /** Keluar dari sesi. */
  keluar: svg('<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/>'
    + '<path d="m15.5 16.5 4.5-4.5-4.5-4.5"/><path d="M20 12H9.5"/>', 18),

  /** QR: dipakai pada tombol yang membuka kode undangan. */
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/>'
    + '<rect x="14" y="3" width="7" height="7" rx="1"/>'
    + '<rect x="3" y="14" width="7" height="7" rx="1"/>'
    + '<path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>', 18),

  /** Unduh berkas, mis. laporan PDF. */
  unduh: svg('<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/>'
    + '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 18),

  /** Membagikan tautan laporan. */
  bagikan: svg('<circle cx="6" cy="12" r="2.6"/><circle cx="17.5" cy="6" r="2.6"/>'
    + '<circle cx="17.5" cy="18" r="2.6"/>'
    + '<path d="m8.4 10.8 6.7-3.5M8.4 13.2l6.7 3.5"/>', 18),

  /** Pencarian pada daftar. */
  cari: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', 18),

  /** Menambah entitas baru. */
  tambah: svg('<path d="M12 5v14M5 12h14"/>', 18),

  /** Memuat ulang atau menjalankan kembali. */
  ulang: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>', 18),

  /** Keadaan berhasil. */
  ok: svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.4 2.4 4.6-5.2"/>', 18),

  /** Peringatan atau temuan yang perlu perhatian. */
  awas: svg('<path d="M10.3 4.3 2.6 17.4A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3.1L13.7 4.3a2 2 0 0 0-3.4 0z"/>'
    + '<path d="M12 9.5v4M12 16.8h.01"/>', 18),

  /** Mengubah data yang sudah ada. */
  ubah: svg('<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z"/><path d="M13.5 6.5 17.5 10.5"/>', 18),

  /** Menghapus data secara permanen. */
  hapus: svg('<path d="M4 7h16"/><path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/>'
    + '<path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/>'
    + '<path d="M10.5 11v5.5M13.5 11v5.5"/>', 18),

  /** Kembali ke halaman sebelumnya. */
  kembali: svg('<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>', 18),
} as const

export type IconName = keyof typeof ICONS
