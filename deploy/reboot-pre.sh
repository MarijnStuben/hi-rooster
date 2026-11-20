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
node -e 'const a=JSON.parse(require("fs").readFileSync("/root/.pm2/dump.pm2","utf8"));process.exit(a.some(p=>p.name==="hi-rooster"&&p.pm_exec_path==="/var/www/hi-rooster/server.js")?0:1)' \
  && echo ja || { echo "hi-rooster staat niet (goed) in /root/.pm2/dump.pm2"; fail=1; }
echo "=== Schijfruimte ==="; df -h / | tail -1
echo "=== Database aanwezig? ==="; ls -l /var/www/hi-rooster/data/hi-rooster.db || fail=1

if [ "$fail" != 0 ]; then
  echo "ONVEILIG: de droplet wordt NIET herstart."
  exit 1
fi

if [ "${DO_REBOOT:-0}" = "1" ]; then
  cd /var/www/hi-rooster && mkdir -p backups
  stamp=$(date +%Y%m%d-%H%M%S)
  if command -v sqlite3 >/dev/null; then
    sqlite3 data/hi-rooster.db ".backup 'backups/pre-reboot-$stamp.db'" && echo "back-up via sqlite3"
  else
    # Zonder sqlite3: kopieer ook de WAL-bestanden, anders ontbreken de nieuwste wijzigingen.
    for ext in "" -wal -shm; do [ -f "data/hi-rooster.db$ext" ] && cp "data/hi-rooster.db$ext" "backups/pre-reboot-$stamp.db$ext"; done
    echo "back-up via kopie (incl. WAL)"
  fi
  ls -l backups/pre-reboot-$stamp.db*
  # Sla de huidige pm2-toestand op, zodat de app na de herstart precies zo terugkomt.
  pm2 save --force 2>&1 | tail -2
  echo "Herstart gepland over 3 seconden."
  nohup bash -c 'sleep 3; systemctl reboot' >/dev/null 2>&1 &
fi
exit 0
