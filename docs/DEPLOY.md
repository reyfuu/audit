# Deployment

Catatan operasional untuk instalasi di VPS. Ditulis supaya orang lain, atau
saya sendiri enam bulan lagi, dapat mengulang atau memperbaikinya tanpa menebak.

## Ringkasan instalasi berjalan

| Hal | Nilai |
|---|---|
| Host | `aipreneur-vps` (31.97.66.119) |
| Domain | `audit.aipreneur.co.id` |
| Direktori | `/var/www/siapai` |
| Repo bare | `/var/git/siapai.git` |
| Service | `siapai.service` (systemd) |
| Port aplikasi | 20140 (web), 20141 (API, hanya loopback) |
| Basis data | PostgreSQL `siapai` |
| Berkas rahasia | `/etc/siapai.env` (mode 600) |
| Nginx | `/etc/nginx/sites-available/siapai-aipreneur` |

API sengaja **tidak** diekspos ke internet. Web memanggilnya lewat handler
in-process, sehingga port 20141 hanya ada supaya Elysia punya alamat internal.

## Menerbitkan perubahan

```bash
# Dari laptop
git push vps master

# Di server
ssh aipreneur-vps
cd /var/www/siapai
git pull origin master
bun install --frozen-lockfile
bunx drizzle-kit migrate        # hanya bila ada migrasi baru
systemctl restart siapai
journalctl -u siapai -n 20 --no-pager
```

Migrasi dijalankan terpisah dan tidak otomatis saat start. Skema basis data
adalah hal yang tidak dapat dibatalkan begitu saja, jadi keputusannya sebaiknya
disengaja, bukan efek samping dari restart.

## Akun demo

```bash
ssh aipreneur-vps
cd /var/www/siapai
set -a; . /etc/siapai.env; set +a
bun apps/web/demo/seed.ts
```

Menghasilkan `admin@example.com` / `password123` beserta lima perusahaan contoh
pada kondisi berbeda. Skrip ini idempoten: perusahaan yang sudah ada dilewati,
dan kata sandi demo selalu dikembalikan ke nilai yang tercetak. Aman dijalankan
berulang kali.

Ubah kredensialnya lewat `DEMO_EMAIL` dan `DEMO_PASSWORD` bila perlu.

## Environment

`/etc/siapai.env`, dibaca systemd lewat `EnvironmentFile`:

| Variabel | Guna |
|---|---|
| `NODE_ENV=production` | Mematikan token pengembangan dan mewajibkan `AUTH_SECRET` |
| `PORT`, `API_PORT` | Port web dan API internal |
| `PUBLIC_BASE_URL` | Menentukan tautan undangan, QR, dan penandaan cookie `Secure` |
| `DATABASE_URL` | Tanpa ini aplikasi jatuh ke penyimpanan memori dan data hilang tiap restart |
| `AUTH_SECRET` | Kunci tanda tangan JWT dan hash token |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Tinjauan AI; tanpa kunci, fiturnya melapor 503 secara jujur |

Proses **menolak menyala** di produksi tanpa `AUTH_SECRET`. Berjalan memakai
kunci pengembangan yang diketahui umum lebih berbahaya daripada gagal menyala.

## TLS

Sertifikat saat ini meminjam milik `prodpilot.aipreneur.co.id`, karena catatan
DNS `audit.aipreneur.co.id` belum dibuat saat instalasi. Begitu DNS mengarah ke
31.97.66.119, terbitkan yang benar:

```bash
ssh aipreneur-vps
certbot --nginx -d audit.aipreneur.co.id
nginx -t && systemctl reload nginx
```

Sampai itu dilakukan, peramban akan memperingatkan ketidakcocokan nama.

## Memeriksa keadaan

```bash
systemctl status siapai
journalctl -u siapai -f
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20140/
sudo -u postgres psql -d siapai -c 'SELECT count(*) FROM companies'
```

## Mengembalikan ke versi sebelumnya

```bash
cd /var/www/siapai
git log --oneline -5
git checkout <commit-sebelumnya>
systemctl restart siapai
```

Perhatikan bahwa ini **tidak** membatalkan migrasi basis data. Bila rilis yang
bermasalah mengubah skema, pemulihannya perlu direncanakan tersendiri.
