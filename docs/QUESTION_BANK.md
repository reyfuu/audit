# QUESTION_BANK — Bank Pertanyaan v1.0
Skor opsi 0–100. `w` = bobot pertanyaan dalam dimensinya. `Q` = termasuk Quick Check.
Tipe: `SC` single_choice · `MC` multi_choice · `S5` scale_1_5 · `B` boolean · `N` number.

---

## Section 0 — Profil Organisasi (tidak diskor)
| Kode | Pertanyaan | Tipe |
|---|---|---|
| ORG-01 | Nama perusahaan | text |
| ORG-02 | Jumlah karyawan | SC `1_9 / 10_49 / 50_99 / 100_499 / 500_999 / 1000_plus` |
| ORG-03 | Industri utama | SC (enum industry) |
| ORG-04 | Omzet tahunan | SC (enum revenue_band_idr) |
| ORG-05 | Peran Anda | SC `owner / c_level / manager / staff / consultant` |
| ORG-06 | Lokasi operasi utama | SC provinsi |

---

## STR — Strategi & Kepemimpinan (bobot dimensi 15%)
**STR-01 (SC, w=3, Q)** Apakah perusahaan punya tujuan bisnis spesifik yang ingin dicapai dengan AI?
- 0 Belum pernah dibahas serius
- 25 Pernah dibahas, belum ada keputusan
- 50 Ada minat umum, belum ada target terukur
- 75 Ada 1–2 use case dengan target terukur
- 100 Ada portofolio use case berprioritas dengan target & pemilik

**STR-02 (SC, w=3, Q)** Siapa yang mensponsori inisiatif AI?
- 0 Tidak ada · 25 Staf yang tertarik · 50 Manajer menengah · 75 Direktur/VP · 100 CEO/pemilik dengan mandat tertulis

**STR-03 (SC, w=2)** Apakah ada anggaran yang dialokasikan untuk AI tahun ini?
- 0 Tidak ada · 25 Ada wacana · 50 < Rp 100 jt · 75 Rp 100–500 jt · 100 > Rp 500 jt / pos anggaran tetap

**STR-04 (SC, w=2)** Bagaimana keputusan investasi teknologi diambil?
- 0 Ad-hoc oleh pemilik · 25 Berdasarkan rekomendasi vendor · 50 Ada proses pengajuan · 75 Ada business case tertulis · 100 Business case + review pasca-implementasi

**STR-05 (SC, w=2)** Apakah ada rencana AI tertulis (roadmap/strategi)?
- 0 Tidak · 50 Draft informal · 100 Dokumen disetujui dengan milestone

**STR-06 (S5, w=1)** Seberapa besar toleransi manajemen terhadap eksperimen yang gagal? (1 sangat rendah → 5 sangat tinggi)

---

## DAT — Data (bobot dimensi 25%) — dimensi terberat, ada hard gate < 40
**DAT-01 (SC, w=4, Q)** Di mana data operasional utama Anda disimpan?
- 0 Kertas / catatan pribadi
- 25 Spreadsheet tersebar di banyak orang
- 50 Beberapa aplikasi terpisah (silo), tidak terhubung
- 75 Sistem terpusat (ERP/POS/CRM) untuk sebagian besar proses
- 100 Sistem terpusat + data warehouse/lakehouse terkonsolidasi

**DAT-02 (SC, w=4, Q)** Berapa lama riwayat data transaksi yang tersedia dan dapat diakses?
- 0 < 3 bulan · 25 3–12 bulan · 50 1–2 tahun · 75 2–3 tahun · 100 > 3 tahun konsisten

**DAT-03 (SC, w=4, Q)** Bagaimana kualitas data Anda (duplikat, kosong, format tidak konsisten)?
- 0 Banyak masalah, tidak pernah dibersihkan
- 25 Diketahui bermasalah, dibersihkan manual saat perlu
- 50 Pembersihan berkala manual
- 75 Ada aturan validasi di titik input
- 100 Ada pemantauan kualitas data otomatis dengan metrik

**DAT-04 (SC, w=3)** Seberapa mudah tim mengakses data untuk analisis?
- 0 Harus minta manual ke IT, berhari-hari
- 25 Ekspor berkala mingguan/bulanan
- 50 Dashboard self-service terbatas
- 75 Akses API/warehouse terdokumentasi
- 100 Real-time, bertata kelola, self-service

**DAT-05 (SC, w=3)** Apakah ada definisi metrik/istilah bisnis yang disepakati bersama?
- 0 Tiap divisi punya definisi sendiri · 50 Sebagian disepakati lisan · 100 Ada kamus data/metrik tertulis dan dipakai

**DAT-06 (SC, w=2)** Siapa yang bertanggung jawab atas data (data owner/steward)?
- 0 Tidak ada · 50 IT merangkap · 100 Ada peran data owner per domain

**DAT-07 (MC, w=2)** Jenis data apa yang Anda miliki dalam bentuk digital? (transaksi penjualan, pelanggan, inventaris, keuangan, operasional/produksi, teks/dokumen, gambar/video, sensor/IoT) — skor proporsional jumlah dipilih.

**DAT-08 (SC, w=2)** Apakah data pelanggan Anda memiliki dasar pemrosesan/konsent yang tercatat?
- 0 Tidak tahu · 50 Ada kebijakan privasi tapi consent tidak tercatat · 100 Consent tercatat dan dapat ditarik

---

## TEC — Teknologi & Infrastruktur (15%)
**TEC-01 (SC, w=3, Q)** Bagaimana infrastruktur sistem Anda?
- 0 Tidak ada sistem terkomputerisasi · 25 On-premise saja, tanpa rencana · 50 On-premise dengan rencana migrasi · 75 Hybrid cloud · 100 Cloud-native
**TEC-02 (SC, w=3)** Apakah sistem inti Anda punya API untuk integrasi?
- 0 Tidak / tidak tahu · 25 Hanya ekspor file · 50 API terbatas dari vendor · 75 API terdokumentasi untuk sebagian besar sistem · 100 Semua sistem terintegrasi via API/event
**TEC-03 (SC, w=2)** Bagaimana sistem antar-divisi saling terhubung?
- 0 Tidak terhubung, entri ulang manual · 50 Integrasi titik-ke-titik ad-hoc · 100 Integrasi terkelola (iPaaS/event bus)
**TEC-04 (SC, w=2, visible jika TEC-01 ≥ on-premise) Apakah ada rencana & anggaran modernisasi infrastruktur 12 bulan ke depan?
- 0 Tidak · 50 Ada rencana tanpa anggaran · 100 Rencana + anggaran disetujui
**TEC-05 (SC, w=2)** Apakah tim menggunakan kontrol versi & proses rilis terkelola?
- 0 Tidak ada tim teknis internal · 50 Ada, proses manual · 100 CI/CD otomatis
**TEC-06 (B, w=2)** Apakah sudah pernah menjalankan model/analitik lanjutan di produksi? (false 0 / true 100)
**TEC-07 (SC, w=1)** Kapasitas komputasi untuk beban kerja AI?
- 0 Tidak ada · 50 Bisa sewa cloud sesuai kebutuhan · 100 Sudah tersedia & teranggarkan

---

## PPL — SDM & Keterampilan (15%)
**PPL-01 (SC, w=3, Q)** Apakah ada orang di perusahaan yang mampu mengolah dan menganalisis data?
- 0 Tidak ada · 25 Ada yang mahir spreadsheet · 50 Ada analis data khusus · 75 Ada tim data/BI · 100 Ada data scientist/ML engineer
**PPL-02 (SC, w=3)** Tingkat literasi data manajemen dalam mengambil keputusan?
- 0 Keputusan berbasis intuisi · 25 Lihat laporan sesekali · 50 Rutin memakai laporan · 75 Memakai dashboard & metrik · 100 Uji hipotesis/eksperimen sebelum memutuskan
**PPL-03 (SC, w=2)** Apakah ada program pelatihan teknologi/data untuk karyawan?
- 0 Tidak ada · 50 Ad-hoc sesuai permintaan · 100 Program terjadwal dengan anggaran
**PPL-04 (SC, w=2)** Bagaimana kesiapan karyawan menghadapi perubahan cara kerja?
- 0 Resistensi tinggi · 50 Netral, perlu dorongan · 100 Antusias, sudah ada yang berinisiatif
**PPL-05 (SC, w=2)** Apakah ada karyawan yang sudah memakai alat AI (mis. asisten AI) dalam pekerjaan?
- 0 Tidak ada/dilarang · 25 Beberapa diam-diam · 50 Beberapa terbuka · 75 Banyak dengan panduan · 100 Terstandarisasi dengan lisensi resmi
**PPL-06 (SC, w=2)** Akses ke mitra/vendor teknologi tepercaya?
- 0 Tidak punya · 50 Pernah bekerja sama · 100 Kemitraan berjalan
**PPL-07 (SC, w=1, visible jika ORG-02 ≥ 100_499)** Apakah ada struktur tim data/AI khusus?
- 0 Tidak · 50 Fungsi tersebar · 100 Tim khusus dengan pemimpin

---

## PRC — Proses & Operasi (10%)
**PRC-01 (SC, w=3, Q)** Seberapa terdokumentasi proses bisnis inti Anda?
- 0 Tidak tertulis, di kepala orang · 25 Sebagian kecil · 50 Proses utama tertulis · 75 Sebagian besar tertulis & diperbarui · 100 Semua tertulis, diaudit berkala
**PRC-02 (SC, w=3)** Seberapa standar proses berjalan antar cabang/tim?
- 0 Sangat bervariasi · 50 Standar sebagian · 100 Seragam & terukur dengan SLA
**PRC-03 (SC, w=2)** Tingkat otomasi saat ini?
- 0 Semua manual · 25 Otomasi spreadsheet · 50 Beberapa alur otomatis di aplikasi · 75 Workflow lintas sistem otomatis · 100 Otomasi dipantau dengan metrik
**PRC-04 (MC, w=2)** Proses mana yang paling memakan waktu manual? (input data, pelaporan, layanan pelanggan, persetujuan, rekonsiliasi, penjadwalan, quality check) — tidak diskor, dipakai untuk rekomendasi use case.
**PRC-05 (SC, w=2)** Apakah kinerja proses diukur dengan KPI?
- 0 Tidak · 50 Beberapa KPI dilaporkan bulanan · 100 KPI real-time dengan pemilik

---

## GOV — Tata Kelola, Risiko & Kepatuhan (10%) — hard gate < 30
**GOV-01 (SC, w=3, Q)** Apakah ada kebijakan tertulis tentang penggunaan AI?
- 0 Tidak ada · 50 Sedang disusun · 100 Ada, disosialisasikan, ditinjau berkala
**GOV-02 (SC, w=3)** Kesiapan kepatuhan UU PDP No. 27/2022?
- 0 Belum tahu kewajibannya · 25 Tahu, belum bertindak · 50 Kebijakan privasi ada · 75 Ada pemetaan data pribadi & prosedur hak subjek data · 100 + DPO/penanggung jawab dan audit berkala
**GOV-03 (SC, w=2)** Apakah ada kontrol akses berbasis peran pada sistem data?
- 0 Akses dibagi bersama · 50 Sebagian sistem · 100 Semua sistem dengan review akses berkala
**GOV-04 (SC, w=2)** Apakah ada proses manajemen risiko/ persetujuan untuk teknologi baru?
- 0 Tidak · 50 Informal · 100 Formal dengan daftar risiko
**GOV-05 (B, w=1)** Apakah ada jejak audit (log) atas perubahan data penting?
**GOV-06 (SC, w=1)** Apakah ada regulasi sektoral yang mengikat (OJK, Kemenkes, dll.)?
- Digunakan untuk memilih rekomendasi kepatuhan; skor netral 50 bila "ya, sudah dipetakan", 0 bila "ya, belum dipetakan", 100 bila "tidak ada".

---

## FIN — Finansial & Nilai (10%)
**FIN-01 (SC, w=3, Q)** Apakah Anda dapat mengukur biaya proses yang ingin diperbaiki?
- 0 Tidak tahu · 50 Perkiraan kasar · 100 Angka akurat per proses
**FIN-02 (SC, w=3)** Kesediaan investasi awal untuk pilot AI dalam 12 bulan?
- 0 Rp 0 · 25 < Rp 50 jt · 50 Rp 50–150 jt · 75 Rp 150–500 jt · 100 > Rp 500 jt
**FIN-03 (SC, w=2)** Ekspektasi waktu balik modal?
- 0 < 3 bulan (tidak realistis) · 50 3–6 bulan · 100 6–18 bulan (realistis) · 75 > 18 bulan
**FIN-04 (SC, w=2)** Apakah ada kerangka evaluasi ROI untuk proyek teknologi?
- 0 Tidak · 50 Ad-hoc · 100 Terstandar dengan review pasca-implementasi

---

## Quick Check (15 pertanyaan, tier gratis)
`ORG-02, ORG-03, STR-01, STR-02, DAT-01, DAT-02, DAT-03, DAT-04, TEC-01, TEC-02, PPL-01, PPL-02, PRC-01, GOV-01, FIN-02`
Skoring Quick Check memakai bobot dimensi yang sama, dinormalisasi terhadap pertanyaan yang tersedia, dan hasilnya ditandai `confidence: LOW`.

---

## Contoh Aturan Rekomendasi
| Kode | Pemicu | Judul | Dampak | Usaha | Horizon |
|---|---|---|---|---|---|
| REC-DAT-001 | `DAT-01 ≤ 25` | Konsolidasikan data operasional ke satu sistem terpusat | 5 | 4 | 3_6M |
| REC-DAT-002 | `DAT-03 ≤ 25` | Terapkan validasi di titik input dan bersihkan master data | 5 | 2 | 0_3M |
| REC-DAT-003 | `DAT-05 = 0` | Susun kamus metrik bisnis bersama | 4 | 1 | 0_3M |
| REC-GOV-001 | `GOV-02 ≤ 25` | Petakan data pribadi dan susun prosedur hak subjek data (UU PDP) | 5 | 2 | 0_3M |
| REC-STR-001 | `STR-01 ≤ 25` | Jalankan lokakarya identifikasi use case dengan kriteria nilai | 4 | 1 | 0_3M |
| REC-PPL-001 | `PPL-01 ≤ 25` | Latih 3–5 champion data internal | 4 | 2 | 0_3M |
| REC-TEC-001 | `TEC-02 ≤ 25` | Minta akses API ke vendor sistem inti atau bangun lapisan integrasi | 4 | 3 | 3_6M |
| REC-PRC-001 | `PRC-01 ≤ 25` | Dokumentasikan 3 proses inti yang paling mahal | 3 | 2 | 0_3M |
| REC-FIN-001 | `FIN-01 ≤ 50` | Ukur biaya baseline proses target sebelum investasi | 5 | 1 | 0_3M |
