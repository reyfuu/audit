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
| TLS | Let's Encrypt, diperbarui otomatis oleh `certbot.timer` |
| Cloudflare | Proxied (awan oranye), mode SSL Full |

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

Sertifikat Let's Encrypt untuk `audit.aipreneur.co.id` sudah terbit dan
diperbarui otomatis oleh timer `certbot.timer` bawaan sistem. HTTP dialihkan
ke HTTPS lewat blok yang ditambahkan certbot.

Bila suatu saat perlu menerbitkan ulang atau menambah nama baru:

```bash
ssh aipreneur-vps
cd /var/www/siapai
bash tools/aktifkan-tls.sh
```

Skrip itu memeriksa DNS dan jalur verifikasi ACME lebih dulu, lalu berhenti
dengan instruksi konkret bila belum siap. Itu disengaja: `certbot` yang
dijalankan terlalu cepat akan gagal sambil menghabiskan kuota percobaan
Let's Encrypt, dan pesan galatnya tidak menyebut penyebab sebenarnya.

### Proxy Cloudflare

Domain ini **proxied** (awan oranye), berbeda dari `9router` dan `prodpilot`
yang DNS only. Konsekuensinya:

- Pengunjung melihat sertifikat Cloudflare, bukan Let's Encrypt milik server.
  Itu normal dan bukan tanda kesalahan; sertifikat server tetap dipakai pada
  sambungan Cloudflare ke origin.
- Mode SSL/TLS di Cloudflare **harus** Full atau Full (strict), tidak boleh
  Flexible. Dengan Flexible, Cloudflare menghubungi origin lewat HTTP polos
  sementara pengunjung melihat HTTPS, dan cookie sesi yang bertanda `Secure`
  tidak akan pernah terkirim balik sehingga login gagal tanpa penjelasan.
  Terverifikasi: Cloudflare menghubungi origin di port 443, dan login lewat
  domain publik berhasil.
- IP asli server tersembunyi, dan lalu lintas mendapat perlindungan DDoS.

Untuk menerbitkan ulang sertifikat lewat verifikasi HTTP, proxy perlu
dimatikan sementara agar Let's Encrypt dapat mencapai server secara langsung.

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
