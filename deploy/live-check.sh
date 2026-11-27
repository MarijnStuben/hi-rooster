#!/bin/bash
# Alleen lezen. Toont per kliniek de verantwoordelijke (gebruikersnaam). Geen wachtwoorden of persoonsgegevens.
cd /var/www/hi-rooster || exit 1
node -e '
const D=require("better-sqlite3")("data/hi-rooster.db",{readonly:true});
const rows=D.prepare("SELECT c.name, c.type, c.active, u.username AS manager FROM clinics c LEFT JOIN users u ON u.id=c.manager_id ORDER BY c.name COLLATE NOCASE").all();
rows.forEach(r=>console.log("KLINIEK|"+r.name+"|"+r.type+"|"+r.active+"|"+(r.manager||"")));
console.log("AANTAL|"+rows.length);'
