#!/bin/bash
# Draait op de droplet vóór een herstart. Stopt (exit 1) als de app na een
# herstart niet vanzelf zou terugkomen. Maakt daarna een back-up en plant de herstart.
set -uo pipefail
fail=0
echo "=== Kern nu / nieuwste geïnstalleerd ==="; uname -r
echo "=== nginx start vanzelf op? ==="
systemctl is-enabled nginx || fail=1
echo "=== pm2 start vanzelf op? ==="
systemctl is-enabled pm2-root || { echo "pm2-root service ontbreekt"; fail=1; }
echo "=== pm2 onthoudt hi-rooster? ==="
grep -q '"name":"hi-rooster"' /root/.pm2/dump.pm2 2>/dev/null && echo ja || { echo "hi-rooster staat niet in /root/.pm2/dump.pm2"; fail=1; }
echo "=== Schijfruimte ==="; df -h / | tail -1
echo "=== Database aanwezig? ==="; ls -l /var/www/hi-rooster/data/hi-rooster.db || fail=1

if [ "$fail" != 0 ]; then
  echo "ONVEILIG: de droplet wordt NIET herstart."
  exit 1
fi

if [ "${DO_REBOOT:-0}" = "1" ]; then
  mkdir -p /var/www/hi-rooster/backups
  stamp=$(date +%Y%m%d-%H%M%S)
  if command -v sqlite3 >/dev/null; then
    sqlite3 /var/www/hi-rooster/data/hi-rooster.db ".backup '/var/www/hi-rooster/backups/pre-reboot-$stamp.db'"
  else
    cp /var/www/hi-rooster/data/hi-rooster.db "/var/www/hi-rooster/backups/pre-reboot-$stamp.db"
  fi
  ls -l /var/www/hi-rooster/backups/pre-reboot-$stamp.db
  echo "Herstart gepland over 3 seconden."
  nohup bash -c 'sleep 3; systemctl reboot' >/dev/null 2>&1 &
fi
exit 0
