#!/bin/bash
# Draait op de droplet (via .github/workflows/server-onderhoud.yml).
# Werkt ALLEEN nginx bij met de pakketbeheerder van Ubuntu, test de
# instellingen en herstart nginx. Herstart de droplet niet.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

echo "=== Systeem ==="; lsb_release -ds 2>/dev/null; uname -r
echo "=== nginx vooraf ==="; nginx -v 2>&1
echo "=== Herkomst nginx-pakket ==="; apt-cache policy nginx 2>/dev/null | head -8
echo "=== HTTP/2 in instellingen ==="; grep -rn "http2" /etc/nginx/ 2>/dev/null || echo "(geen http2-regels gevonden)"

echo "=== Pakketlijst verversen ==="
apt-get update -q >/dev/null 2>&1 && echo ok || echo "apt-get update mislukt"
echo "=== Beschikbare nginx-updates ==="
apt list --upgradable 2>/dev/null | grep -i nginx || echo "(geen nginx-update beschikbaar)"

if [ "${DO_UPGRADE:-0}" = "1" ]; then
  pkgs=$(dpkg-query -W -f='${Package} ${Status}\n' 'nginx*' 'libnginx*' 2>/dev/null | awk '/install ok installed/{print $1}' | tr '\n' ' ')
  echo "=== Bijwerken: $pkgs ==="
  if [ -n "$pkgs" ]; then
    apt-get install -y -q --only-upgrade -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef $pkgs 2>&1 | tail -15
  fi
  echo "=== Instellingen testen ==="
  if nginx -t 2>&1; then
    systemctl restart nginx && echo "nginx herstart" || echo "HERSTART MISLUKT"
  else
    echo "INSTELLINGEN ONGELDIG: nginx NIET herstart"
  fi
fi

echo "=== nginx achteraf ==="; nginx -v 2>&1
systemctl is-active nginx
echo "=== Website lokaal bereikbaar? ==="
curl -sk -o /dev/null -w "https://localhost -> %{http_code}\n" --max-time 10 https://localhost/ -H "Host: rooster-hi.nl" || true
echo "=== Herstart droplet nodig? ==="
[ -f /var/run/reboot-required ] && { echo "JA"; cat /var/run/reboot-required.pkgs 2>/dev/null | head -10; } || echo "nee"
