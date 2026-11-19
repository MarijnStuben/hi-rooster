#!/bin/bash
# Draait op de droplet tijdens een deploy (aangeroepen door .github/workflows/deploy.yml).
set -euo pipefail
cd "$DEPLOY_PATH"

# 1. Back-up van de database vóór elke deploy (laatste 20 bewaard).
if [ -f data/hi-rooster.db ]; then
  mkdir -p backups
  stamp=$(date +%Y%m%d-%H%M%S)
  if command -v sqlite3 >/dev/null; then
    sqlite3 data/hi-rooster.db ".backup 'backups/hi-rooster-$stamp.db'"
  else
    cp data/hi-rooster.db "backups/hi-rooster-$stamp.db"
  fi
  ls -1t backups/hi-rooster-*.db | tail -n +21 | xargs -r rm --
  echo "Back-up gemaakt: backups/hi-rooster-$stamp.db"
fi

# 2. Pakketten installeren.
npm install --omit=dev --no-audit --no-fund

# 3. App herstarten.
if [ -n "${DEPLOY_RESTART_CMD:-}" ]; then
  eval "$DEPLOY_RESTART_CMD"
elif command -v pm2 >/dev/null && pm2 describe hi-rooster >/dev/null 2>&1; then
  pm2 restart hi-rooster --update-env
elif systemctl list-unit-files hi-rooster.service >/dev/null 2>&1 && systemctl cat hi-rooster.service >/dev/null 2>&1; then
  sudo -n systemctl restart hi-rooster
else
  echo "Kon de app niet herstarten: geen pm2-proces of systemd-service 'hi-rooster' gevonden."
  echo "Stel de repository secret DEPLOY_RESTART_CMD in met het juiste herstartcommando."
  exit 1
fi
echo "Deploy klaar."
