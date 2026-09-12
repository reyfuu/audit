#!/bin/bash
# Fix login Google / Antigravity di jaringan IndiHome (Telkom AS7713)
#
# MASALAH: IndiHome memblokir TCP 443 ke blok IP Google 172.217.x.x dan 74.125.x.x.
# DNS Google mengarahkan *.googleapis.com dan gstatic.com ke blok itu, jadi OAuth mati.
# SOLUSI: paksa domain tsb ke IP Google lain (142.251.10.95) yg rutenya lolos.
#
# Jalankan:  sudo bash fix-google-login.sh
# Batalkan:  sudo bash fix-google-login.sh --undo

set -euo pipefail
HOSTS=/etc/hosts
TAG_START="# >>> fix-google-login (IndiHome) >>>"
TAG_END="# <<< fix-google-login (IndiHome) <<<"

if [ "$(id -u)" != "0" ]; then echo "Harus pakai sudo: sudo bash $0"; exit 1; fi

# hapus blok lama (idempoten)
if grep -qF "$TAG_START" "$HOSTS"; then
  cp "$HOSTS" "$HOSTS.bak.$(date +%s)"
  /usr/bin/sed -i '' "/$(echo "$TAG_START" | sed 's/[][\.*^$\/>]/\\&/g')/,/$(echo "$TAG_END" | sed 's/[][\.*^$\/<]/\\&/g')/d" "$HOSTS"
fi

if [ "${1:-}" = "--undo" ]; then
  dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true
  echo "Selesai dibatalkan. /etc/hosts kembali normal."
  exit 0
fi

# pilih IP Google sehat otomatis
CANDIDATES="142.251.10.95 142.250.4.95 172.253.118.95 216.239.32.61"
GOOD=""
for ip in $CANDIDATES; do
  if curl -s -o /dev/null --max-time 6 --resolve www.googleapis.com:443:$ip https://www.googleapis.com/oauth2/v3/certs; then
    GOOD=$ip; break
  fi
done
if [ -z "$GOOD" ]; then echo "Tidak ada IP Google yg lolos. Blokir ISP meluas; pakai VPN/DNS-over-HTTPS."; exit 1; fi
echo "Memakai IP Google: $GOOD"

DOMAINS="
www.googleapis.com
googleapis.com
oauth2.googleapis.com
people.googleapis.com
cloudcode-pa.googleapis.com
generativelanguage.googleapis.com
content-autopush.googleapis.com
securetoken.googleapis.com
identitytoolkit.googleapis.com
firebaseinstallations.googleapis.com
ssl.gstatic.com
www.gstatic.com
fonts.gstatic.com
"

{
  echo "$TAG_START"
  for d in $DOMAINS; do [ -n "$d" ] && echo "$GOOD	$d"; done
  echo "$TAG_END"
} >> "$HOSTS"

dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true

echo "--- Verifikasi ---"
ok=0; bad=0
for d in $DOMAINS; do
  [ -z "$d" ] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "https://$d/" 2>/dev/null || echo 000)
  if [ "$code" = "000" ]; then echo "  GAGAL  $d"; bad=$((bad+1)); else echo "  OK     $d (http $code)"; ok=$((ok+1)); fi
done
echo "Hasil: $ok ok, $bad gagal."
echo "Sekarang tutup total Antigravity/browser lalu coba login Google lagi."
