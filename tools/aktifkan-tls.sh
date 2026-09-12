#!/usr/bin/env bash
#
# Menerbitkan sertifikat TLS untuk audit.aipreneur.co.id.
#
# Dijalankan SETELAH catatan DNS dibuat. Skrip ini memeriksa prasyaratnya lebih
# dulu, karena certbot yang gagal karena DNS belum menyebar akan menghabiskan
# kuota percobaan Let's Encrypt tanpa memberi tahu penyebab sebenarnya.
#
# Jalankan di VPS: bash tools/aktifkan-tls.sh
set -euo pipefail

DOMAIN=audit.aipreneur.co.id
IP_SERVER=31.97.66.119

echo "1. Memeriksa DNS…"
TERCATAT=$(dig +short "$DOMAIN" @1.1.1.1 | tail -1)
if [ -z "$TERCATAT" ]; then
  echo "   GAGAL: $DOMAIN belum punya catatan DNS."
  echo "   Tambahkan A record di Cloudflare:  audit -> $IP_SERVER"
  echo "   Bila memakai proxy Cloudflare (awan oranye), matikan dulu selama"
  echo "   penerbitan, karena verifikasi HTTP harus mencapai server ini langsung."
  exit 1
fi
if [ "$TERCATAT" != "$IP_SERVER" ]; then
  echo "   PERINGATAN: $DOMAIN mengarah ke $TERCATAT, bukan $IP_SERVER."
  echo "   Bila itu IP proxy Cloudflare, matikan proxy-nya selama penerbitan."
  exit 1
fi
echo "   OK: $DOMAIN -> $TERCATAT"

echo "2. Memeriksa jalur verifikasi ACME…"
UJI=/var/www/certbot/.well-known/acme-challenge/uji-tls-$$
mkdir -p "$(dirname "$UJI")"
echo ok > "$UJI"
HASIL=$(curl -s --max-time 10 "http://$DOMAIN/.well-known/acme-challenge/uji-tls-$$" || true)
rm -f "$UJI"
if [ "$HASIL" != "ok" ]; then
  echo "   GAGAL: jalur verifikasi tidak dapat dicapai dari luar."
  exit 1
fi
echo "   OK: jalur verifikasi dapat dicapai"

echo "3. Menerbitkan sertifikat…"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
  --redirect --keep-until-expiring -m admin@aipreneur.co.id

echo "4. Memuat ulang nginx…"
nginx -t && systemctl reload nginx

echo "5. Memverifikasi hasilnya…"
KODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
echo "   https://$DOMAIN/ -> $KODE"
[ "$KODE" = "200" ] || { echo "   Situs belum membalas 200; periksa journalctl -u siapai"; exit 1; }
echo
echo "Selesai. Buka https://$DOMAIN dan masuk dengan akun demo."
