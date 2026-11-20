#!/bin/bash
# Alleen lezen. Toont GEEN omgevingsvariabelen of geheimen, alleen naam, pad en status.
echo "=== dump-bestand ==="; ls -l /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak 2>&1
for f in /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak; do
  [ -f "$f" ] && echo "-- $f --" && node -e '
    const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    console.log("aantal apps:",a.length);
    for(const p of a) console.log(" -",p.name,"|",p.pm_exec_path,"|",p.pm_cwd);' "$f" 2>&1
done
echo "=== pm2 draait nu ==="
pm2 jlist 2>/dev/null | node -e '
  const a=JSON.parse(require("fs").readFileSync(0,"utf8"));
  for(const p of a) console.log(" -",p.name,"|",p.pm2_env.pm_exec_path,"|",p.pm2_env.pm_cwd,"|",p.pm2_env.status);'
echo "=== pm2-root service ==="
systemctl is-enabled pm2-root; systemctl is-active pm2-root
grep -E "^(ExecStart|ExecReload|User|Environment=PM2_HOME)" /etc/systemd/system/pm2-root.service 2>&1
