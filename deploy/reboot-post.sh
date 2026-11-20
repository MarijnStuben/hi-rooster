#!/bin/bash
# Draait op de droplet ná een herstart: laat zien of alles weer draait.
uname -r
echo "nginx: $(systemctl is-active nginx)"
pm2 list 2>/dev/null
echo "app lokaal:   $(curl -s -o /dev/null -w %{http_code} --max-time 10 http://localhost:3000/)"
echo "https lokaal: $(curl -sk -o /dev/null -w %{http_code} --max-time 10 https://localhost/ -H 'Host: rooster-hi.nl')"
echo "nog herstart nodig: $([ -f /var/run/reboot-required ] && echo JA || echo nee)"
