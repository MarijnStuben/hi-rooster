#!/bin/bash
# Alleen lezen. Toont geen wachtwoorden of geheimen.
cd /var/www/hi-rooster || exit 1
echo "=== pm2 ==="; pm2 jlist 2>/dev/null | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const p of a)console.log(p.name,p.pm2_env.status,"herstarts:",p.pm2_env.restart_time)'
echo "=== Migratie in logboek ==="; pm2 logs hi-rooster --lines 60 --nostream 2>/dev/null | grep -E "Migratie|draait op|Fout|Error" | tail -8
echo "=== Gebruikers (naam en rol) ==="
node -e '
const D=require("better-sqlite3")("data/hi-rooster.db",{readonly:true});
console.log(JSON.stringify(D.prepare("select username,role,must_change_password from users").all()));
console.log("klinieken:",D.prepare("select count(*) n from clinics").get().n,"| met verantwoordelijke:",D.prepare("select count(*) n from clinics where manager_id is not null").get().n);
console.log("datums:",D.prepare("select count(*) n from dates").get().n,"| aanmeldingen:",D.prepare("select count(*) n from registrations").get().n);'
echo "=== Site ==="
echo "app lokaal:   $(curl -s -o /dev/null -w %{http_code} --max-time 10 http://localhost:3000/)"
echo "admin lokaal: $(curl -s -o /dev/null -w %{http_code} --max-time 10 http://localhost:3000/admin/)"
echo "https:        $(curl -sk -o /dev/null -w %{http_code} --max-time 10 https://localhost/ -H 'Host: rooster-hi.nl')"
echo "=== Back-ups van vlak voor deze update ==="; ls -1t backups/pre-deploy-* 2>/dev/null | head -2
