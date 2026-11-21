#!/bin/bash
# Alleen lezen. Controleert of PHP op de droplet staat of gebruikt wordt.
echo "=== PHP-programma's ==="; command -v php php-fpm 2>&1 || echo "(geen php gevonden)"
echo "=== PHP-pakketten ==="; dpkg -l 2>/dev/null | awk '/^ii/ && /php/{print $2, $3}' | head -20 || true
dpkg -l 2>/dev/null | grep -qi '^ii.*php' || echo "(geen php-pakketten geïnstalleerd)"
echo "=== PHP-FPM service ==="; systemctl list-units --all --no-pager 2>/dev/null | grep -i php || echo "(geen php-service)"
echo "=== nginx: FastCGI/PHP in instellingen ==="; grep -rnE "fastcgi|php" /etc/nginx/ 2>/dev/null || echo "(geen fastcgi/php-regels)"
echo "=== Apache ==="; (command -v apache2 || systemctl is-active apache2) 2>&1 | head -2
echo "=== Luisterende poorten ==="; ss -ltnH 2>/dev/null | awk '{print $4}' | sort -u
echo "=== .php-bestanden onder /var/www ==="; find /var/www -name '*.php' -not -path '*/node_modules/*' 2>/dev/null | head -5; echo "(einde lijst)"
