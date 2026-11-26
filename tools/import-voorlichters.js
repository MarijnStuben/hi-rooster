#!/usr/bin/env node
/*
 * Bouwt voorlichtersprofielen en hun geschiedenis op uit de back-ups.
 *
 *   node tools/import-voorlichters.js            proefrun: toont wat er zou gebeuren, wijzigt niets
 *   node tools/import-voorlichters.js --apply    voert de import echt uit (eerst een back-up)
 *   --dir <map>                                  andere map met back-ups (standaard: backups/)
 *
 * Leest alle *.sql (dumps) en *.db (kopieën) in de map. Telt alleen goedgekeurde aanmeldingen
 * met een datum van vandaag of eerder. Veilig om opnieuw te draaien: dezelfde voorlichting
 * wordt nooit dubbel geteld.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initDb, db, educatorHelpers, guessClinicType, todayISO } = require('../db');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dirIdx = args.indexOf('--dir');
const dir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : path.join(__dirname, '..', 'backups');

initDb();
const today = todayISO();

if (!fs.existsSync(dir)) { console.error(`Map niet gevonden: ${dir}`); process.exit(1); }
const files = fs.readdirSync(dir)
  .filter(f => /\.(sql|db)$/.test(f) && !f.startsWith('pre-import'))
  .sort();

console.log(`${apply ? 'IMPORT' : 'PROEFRUN'} - ${files.length} back-upbestanden in ${dir}`);

function openBackup(file) {
  const full = path.join(dir, file);
  if (file.endsWith('.sql')) {
    const m = new Database(':memory:');
    m.pragma('foreign_keys = OFF'); // een dump laadt tabellen in alfabetische volgorde
    m.exec(fs.readFileSync(full, 'utf8'));
    return m;
  }
  return new Database(full, { readonly: true, fileMustExist: true });
}

const liveClinic = db.prepare('SELECT id, type FROM clinics WHERE name = ? COLLATE NOCASE');
const addSession = db.prepare(`INSERT OR IGNORE INTO educator_sessions (educator_id, clinic_id, clinic_name, clinic_type, date) VALUES (?,?,?,?,?)`);
const countEducators = () => db.prepare('SELECT COUNT(*) AS n FROM educators').get().n;
const countSessions = () => db.prepare('SELECT COUNT(*) AS n FROM educator_sessions').get().n;

const stats = { read: 0, unreadable: 0, rows: 0, skipped: 0 };
const before = { educators: countEducators(), sessions: countSessions() };

class DryRun extends Error {}
let after = null;
function run() {
  for (const file of files) {
    let src;
    try { src = openBackup(file); } catch (e) { stats.unreadable++; console.log(`  overgeslagen (onleesbaar): ${file} - ${e.message.split('\n')[0]}`); continue; }
    try {
      const rows = src.prepare(`
        SELECT p.*, c.name AS clinic_name, d.date AS session_date
        FROM persons p
        JOIN registrations r ON r.id = p.registration_id
        JOIN dates d ON d.id = r.date_id
        JOIN clinics c ON c.id = d.clinic_id
        WHERE r.status = 'approved' AND d.date <= ?`).all(today);
      stats.read++;
      for (const r of rows) {
        stats.rows++;
        const eid = educatorHelpers.findOrCreate(r);
        if (!eid) { stats.skipped++; continue; }
        const lc = liveClinic.get(r.clinic_name);
        addSession.run(eid, lc ? lc.id : null, r.clinic_name, lc ? lc.type : guessClinicType(r.clinic_name), r.session_date);
      }
    } catch (e) {
      stats.unreadable++; console.log(`  overgeslagen (geen geldige back-up): ${file} - ${e.message.split('\n')[0]}`);
    } finally { src.close(); }
  }
  // Vastleggen vóórdat een proefrun wordt teruggedraaid.
  const exp = educatorHelpers.experience(null);
  const eds = db.prepare('SELECT id FROM educators').all();
  after = {
    educators: countEducators(), sessions: countSessions(),
    withExp: eds.filter(e => exp.get(e.id) && exp.get(e.id).total > 0).length,
  };
  if (!apply) throw new DryRun();
}

if (apply) {
  fs.mkdirSync(dir, { recursive: true });
  const safety = path.join(dir, `pre-import-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`);
  db.prepare('VACUUM INTO ?').run(safety);
  console.log(`Back-up van de database vooraf: ${safety}`);
}

try { db.transaction(run)(); } catch (e) { if (!(e instanceof DryRun)) throw e; }

console.log(`\nBestanden gelezen: ${stats.read}${stats.unreadable ? `, overgeslagen: ${stats.unreadable}` : ''}`);
console.log(`Goedgekeurde voorlichtingen (personen) gevonden: ${stats.rows}${stats.skipped ? ` (${stats.skipped} zonder naam overgeslagen)` : ''}`);

console.log(`${apply ? 'Nieuwe profielen' : 'Nieuwe profielen (proef)'}: ${after.educators - before.educators} (totaal ${apply ? 'nu' : 'zou zijn'} ${after.educators})`);
console.log(`${apply ? 'Nieuwe voorlichtingen in de geschiedenis' : 'Nieuwe voorlichtingen (proef)'}: ${after.sessions - before.sessions} (totaal ${apply ? 'nu' : 'zou zijn'} ${after.sessions})`);
console.log(`Profielen met ervaring: ${after.withExp} van ${after.educators}`);
if (!apply) console.log('\nDit was een proefrun: er is niets gewijzigd. Draai met --apply om echt te importeren.');
