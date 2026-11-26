const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hi-rooster.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Hulpfuncties voor voorlichters ────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Soort locatie raden aan de naam: P.I. / penitentiaire inrichting / gevangenis = 'pi', de rest = 'kliniek'.
function guessClinicType(name) {
  const n = String(name || '').toLowerCase();
  if (/^\s*p\.?\s?i\.?(\s|$)/.test(n) || /penitentiair|gevangenis|huis van bewaring/.test(n)) return 'pi';
  return 'kliniek';
}

const normText = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const normBirth = b => (/^\d{4}-\d{2}-\d{2}$/.test(String(b || '')) ? b : '');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clinics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      frequency TEXT DEFAULT '',
      time TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_info TEXT DEFAULT '',
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (date_id) REFERENCES dates(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS educators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      prior_kliniek INTEGER NOT NULL DEFAULT 0,
      prior_pi INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS educator_keys (
      key TEXT PRIMARY KEY,
      name_key TEXT NOT NULL,
      birth_date TEXT DEFAULT '',
      educator_id INTEGER NOT NULL,
      FOREIGN KEY (educator_id) REFERENCES educators(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_educator_keys_name ON educator_keys(name_key);
    CREATE TABLE IF NOT EXISTS educator_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      educator_id INTEGER NOT NULL,
      clinic_id INTEGER,
      clinic_name TEXT NOT NULL,
      clinic_type TEXT NOT NULL DEFAULT 'kliniek',
      date TEXT NOT NULL,
      UNIQUE (educator_id, clinic_name, date),
      FOREIGN KEY (educator_id) REFERENCES educators(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      person_number INTEGER NOT NULL,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      mobile TEXT DEFAULT '',
      FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
    );
  `);

  // Migration: allow_public_signup column
  try {
    db.exec("ALTER TABLE clinics ADD COLUMN allow_public_signup INTEGER DEFAULT 1");
    console.log('Migratie: allow_public_signup kolom toegevoegd');
  } catch (_) { /* kolom bestaat al */ }
  // Altijd Youzz op 0 zetten (ook bij verse installatie)
  db.prepare("UPDATE clinics SET allow_public_signup = 0 WHERE name LIKE '%Youzz%'").run();

  // Migration: clinic_notified column
  try {
    db.exec("ALTER TABLE dates ADD COLUMN clinic_notified INTEGER DEFAULT 0");
    console.log('Migratie: clinic_notified kolom toegevoegd');
  } catch (_) { /* kolom bestaat al */ }

  // Migration: rollen. Bestaande gebruikers worden 'admin' (volledige rechten), zodat
  // niemand toegang verliest. Nieuwe gebruikers krijgen standaard de rol 'manager'.
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
    console.log('Migratie: users.role kolom toegevoegd (bestaande gebruikers zijn admin)');
  } catch (_) { /* kolom bestaat al */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
    console.log('Migratie: users.must_change_password kolom toegevoegd');
  } catch (_) { /* kolom bestaat al */ }

  // Migration: soort locatie (kliniek of PI). Bestaande klinieken worden eenmalig geraden aan de naam.
  try {
    db.exec("ALTER TABLE clinics ADD COLUMN type TEXT NOT NULL DEFAULT 'kliniek'");
    const upd = db.prepare("UPDATE clinics SET type = 'pi' WHERE id = ?");
    db.prepare('SELECT id, name FROM clinics').all().forEach(c => { if (guessClinicType(c.name) === 'pi') upd.run(c.id); });
    console.log('Migratie: clinics.type kolom toegevoegd (P.I.-locaties herkend aan de naam)');
  } catch (_) { /* kolom bestaat al */ }

  // Migration: koppeling aanmelding-persoon -> voorlichtersprofiel
  try {
    db.exec("ALTER TABLE persons ADD COLUMN educator_id INTEGER REFERENCES educators(id) ON DELETE SET NULL");
    console.log('Migratie: persons.educator_id kolom toegevoegd');
  } catch (_) { /* kolom bestaat al */ }
  try {
    db.exec("ALTER TABLE persons ADD COLUMN no_profile INTEGER NOT NULL DEFAULT 0");
  } catch (_) { /* kolom bestaat al */ }

  // Migration: verantwoordelijke (aanmelder) per kliniek
  try {
    db.exec("ALTER TABLE clinics ADD COLUMN manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
    console.log('Migratie: clinics.manager_id kolom toegevoegd');
  } catch (_) { /* kolom bestaat al */ }

  // Alleen bij een lege gebruikerstabel een eerste beheerder aanmaken, en
  // alleen met een wachtwoord uit ADMIN_PASSWORD. Er is geen standaardwachtwoord.
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD;
    if (password) {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, bcrypt.hashSync(password, 10));
      console.log(`Eerste beheerder aangemaakt: ${username}`);
    } else {
      console.warn('Er is nog geen beheerder. Start de app eenmalig met ADMIN_PASSWORD (en eventueel ADMIN_USERNAME) om er een aan te maken.');
    }
  }

  const count = db.prepare('SELECT COUNT(*) as n FROM clinics').get();
  if (count.n === 0) seedData();

  // Voorlichtersprofielen aanmaken voor aanmeldingen die er nog geen hebben.
  const linked = educatorHelpers.backfill();
  if (linked) console.log(`Voorlichtersprofielen: ${linked} personen gekoppeld.`);
}

// ── Voorlichtersprofielen ─────────────────────────────────────────────────
const educatorHelpers = {
  // Zoek het profiel bij een persoon, of maak er een. Matcht op naam + geboortedatum;
  // ontbreekt de geboortedatum, dan op naam als die maar bij één profiel hoort.
  findOrCreate(p) {
    const first = String(p.first_name || '').trim();
    const last = String(p.last_name || '').trim();
    if (!first && !last) return null;
    const birth = normBirth(p.birth_date);
    const phone = String(p.phone || p.mobile || '').trim();
    const nameKey = normText(first) + '|' + normText(last);
    const key = nameKey + '|' + birth;

    let row = db.prepare('SELECT educator_id AS id FROM educator_keys WHERE key = ?').get(key);
    let id = row ? row.id : null;
    if (!id) {
      const cands = birth
        ? db.prepare(`SELECT DISTINCT k.educator_id AS id FROM educator_keys k JOIN educators e ON e.id = k.educator_id
                      WHERE k.name_key = ? AND k.birth_date = '' AND e.birth_date = ''`).all(nameKey)
        : db.prepare('SELECT DISTINCT educator_id AS id FROM educator_keys WHERE name_key = ?').all(nameKey);
      if (cands.length === 1) id = cands[0].id;
    }
    if (!id) {
      id = db.prepare('INSERT INTO educators (first_name, last_name, birth_date, phone) VALUES (?,?,?,?)')
        .run(first, last, birth, phone).lastInsertRowid;
    } else {
      // Alleen lege velden aanvullen, nooit bestaande gegevens overschrijven.
      db.prepare(`UPDATE educators SET
        first_name = CASE WHEN first_name = '' THEN ? ELSE first_name END,
        last_name  = CASE WHEN last_name  = '' THEN ? ELSE last_name  END,
        birth_date = CASE WHEN birth_date = '' THEN ? ELSE birth_date END,
        phone      = CASE WHEN phone      = '' THEN ? ELSE phone      END
        WHERE id = ?`).run(first, last, birth, phone, id);
    }
    db.prepare('INSERT OR IGNORE INTO educator_keys (key, name_key, birth_date, educator_id) VALUES (?,?,?,?)')
      .run(key, nameKey, birth, id);
    return id;
  },

  backfill() {
    const rows = db.prepare('SELECT id, first_name, last_name, birth_date, phone, mobile FROM persons WHERE educator_id IS NULL AND no_profile = 0 ORDER BY id').all();
    if (!rows.length) return 0;
    const link = db.prepare('UPDATE persons SET educator_id = ? WHERE id = ?');
    let n = 0;
    db.transaction(() => {
      rows.forEach(r => { const id = educatorHelpers.findOrCreate(r); if (id) { link.run(id, r.id); n++; } });
    })();
    return n;
  },

  // Profielen zonder aanmeldingen, geschiedenis of handmatige aantallen opruimen.
  gc() {
    db.prepare(`DELETE FROM educators WHERE prior_kliniek = 0 AND prior_pi = 0
      AND NOT EXISTS (SELECT 1 FROM persons WHERE educator_id = educators.id)
      AND NOT EXISTS (SELECT 1 FROM educator_sessions WHERE educator_id = educators.id)`).run();
  },

  // Bewaar goedgekeurde voorlichtingen in de geschiedenis voordat datums worden verwijderd,
  // zodat de ervaring niet verdwijnt bij het opschonen.
  archive(whereSql, params) {
    db.prepare(`INSERT OR IGNORE INTO educator_sessions (educator_id, clinic_id, clinic_name, clinic_type, date)
      SELECT DISTINCT p.educator_id, c.id, c.name, c.type, d.date
      FROM persons p
      JOIN registrations r ON r.id = p.registration_id AND r.status = 'approved'
      JOIN dates d ON d.id = r.date_id
      JOIN clinics c ON c.id = d.clinic_id
      WHERE p.educator_id IS NOT NULL AND ${whereSql}`).run(...params);
  },

  // Ervaring per voorlichter: geschiedenis + lopende aanmeldingen van vandaag of eerder (zonder dubbeltelling).
  // ids = null: alle voorlichters.
  experience(ids) {
    const today = todayISO();
    const useIn = Array.isArray(ids) && ids.length > 0 && ids.length <= 400;
    if (Array.isArray(ids) && !ids.length) return new Map();
    const ph = useIn ? ids.map(() => '?').join(',') : '';
    const f1 = useIn ? `WHERE educator_id IN (${ph})` : '';
    const f2 = useIn ? `AND p.educator_id IN (${ph})` : '';
    const rows = db.prepare(`
      WITH s AS (
        SELECT educator_id, clinic_name, clinic_type, date FROM educator_sessions ${f1}
        UNION
        SELECT p.educator_id, c.name, c.type, d.date
        FROM persons p
        JOIN registrations r ON r.id = p.registration_id AND r.status = 'approved'
        JOIN dates d ON d.id = r.date_id
        JOIN clinics c ON c.id = d.clinic_id
        WHERE p.educator_id IS NOT NULL AND d.date <= ? ${f2}
      )
      SELECT educator_id, clinic_type, clinic_name, COUNT(*) AS n, MAX(date) AS last_date
      FROM s GROUP BY educator_id, clinic_type, clinic_name
    `).all(...(useIn ? ids : []), today, ...(useIn ? ids : []));

    const eds = useIn
      ? db.prepare(`SELECT id, prior_kliniek, prior_pi FROM educators WHERE id IN (${ph})`).all(...ids)
      : db.prepare('SELECT id, prior_kliniek, prior_pi FROM educators').all();
    const map = new Map();
    eds.forEach(e => map.set(e.id, { kliniek: e.prior_kliniek, pi: e.prior_pi, total: 0, last_date: null, places: [] }));
    rows.forEach(r => {
      const x = map.get(r.educator_id); if (!x) return;
      if (r.clinic_type === 'pi') x.pi += r.n; else x.kliniek += r.n;
      x.places.push({ name: r.clinic_name, type: r.clinic_type, n: r.n, last_date: r.last_date });
      if (!x.last_date || r.last_date > x.last_date) x.last_date = r.last_date;
    });
    map.forEach(x => {
      x.total = x.kliniek + x.pi;
      x.places.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    });
    return map;
  },

  // Voeg het veld 'experience' toe aan een lijst personen (wachtrij, weekoverzicht).
  attachExperience(persons) {
    const ids = [...new Set(persons.map(p => p.educator_id).filter(Boolean))];
    const map = educatorHelpers.experience(ids);
    persons.forEach(p => {
      const x = p.educator_id ? map.get(p.educator_id) : null;
      p.experience = x
        ? { kliniek: x.kliniek, pi: x.pi, total: x.total }
        : { kliniek: 0, pi: 0, total: 0 };
    });
    return persons;
  },
};

function seedClinic(name, address, frequency, time, contact_name, contact_info, datesData) {
  const clinic = db.prepare(
    'INSERT INTO clinics (name, address, frequency, time, contact_name, contact_info, type) VALUES (?,?,?,?,?,?,?)'
  ).run(name, address, frequency, time, contact_name, contact_info, guessClinicType(name));

  const insertDate = db.prepare('INSERT INTO dates (clinic_id, date, status) VALUES (?,?,?)');
  const insertReg = db.prepare('INSERT INTO registrations (date_id, status) VALUES (?,?)');
  const insertPerson = db.prepare(
    'INSERT INTO persons (registration_id, person_number, first_name, last_name) VALUES (?,?,?,?)'
  );

  for (const [date, names] of datesData) {
    if (names) {
      const d = insertDate.run(clinic.lastInsertRowid, date, 'approved');
      const r = insertReg.run(d.lastInsertRowid, 'approved');
      const parts = names.split(/[&,]/)
        .map(s => s.trim())
        .filter(s => s && s !== '…' && s !== '...' && !/^\+\d/.test(s));
      parts.forEach((name, i) => {
        const [fn, ...rest] = name.split(' ');
        insertPerson.run(r.lastInsertRowid, i + 1, fn || name, rest.join(' '));
      });
    } else {
      insertDate.run(clinic.lastInsertRowid, date, 'free');
    }
  }
}

function seedData() {
  const seed = db.transaction(() => {
    seedClinic('P.I. Alphen', 'P.I. Alphen aan den Rijn', 'Om de 3 weken op dinsdag', '15:30–16:30', '', '', [
      ['2026-01-13', null], ['2026-02-03', null], ['2026-02-24', null], ['2026-03-17', null],
      ['2026-04-07', 'Thomas & Marley'], ['2026-04-28', 'Wout & Boy'],
      ['2026-05-19', 'Marley & Liesbeth'], ['2026-06-09', 'Pieter'],
      ['2026-06-30', 'Edward & Eric & Frency'], ['2026-07-21', 'Annemieke'],
      ['2026-08-11', null], ['2026-09-01', null], ['2026-09-22', null],
      ['2026-10-13', null], ['2026-11-03', null], ['2026-11-24', null],
      ['2026-12-15', null], ['2027-01-05', null],
    ]);

    seedClinic('Kliniek V FVK', 'Kliniek V FVK', 'Elke eerste woensdag van de maand', '20:00–21:00', '', '', [
      ['2026-01-07', null], ['2026-02-04', null], ['2026-03-04', null], ['2026-04-01', null],
      ['2026-05-06', 'Brian'], ['2026-06-03', 'Richard & Wietze'],
      ['2026-07-01', 'Reinier'], ['2026-08-05', null], ['2026-09-02', null],
      ['2026-10-07', 'Jim & Marley'], ['2026-11-04', null], ['2026-12-02', null],
    ]);

    seedClinic('Youzz Jeugdkliniek', 'Youzz Jeugdkliniek', 'Om de 3 weken op vrijdag', '09:30–12:00', '', '', [
      ['2026-01-09', null], ['2026-01-30', null], ['2026-02-20', null],
      ['2026-03-13', 'Sonja & Shanty'], ['2026-04-10', 'Milano & Marley'],
      ['2026-04-24', 'Edwin'], ['2026-05-15', 'Marijn & David'],
      ['2026-06-05', 'Peet & Roderick'], ['2026-06-26', null], ['2026-07-17', null],
      ['2026-08-07', null], ['2026-08-28', null], ['2026-09-18', 'Sonja & Shanty'],
      ['2026-10-09', null], ['2026-10-30', null], ['2026-11-20', null],
      ['2026-12-11', null], ['2027-01-01', null],
    ]);

    seedClinic('Kliniek V AFZ', 'Kliniek V AFZ', 'Elke eerste dinsdag van de maand', '20:00–21:00', '', '', [
      ['2026-01-06', null], ['2026-02-03', null], ['2026-03-03', null],
      ['2026-04-07', 'Marijn & David'], ['2026-05-05', 'Tommy & Marley'],
      ['2026-06-02', 'Peet & Pieter'], ['2026-07-07', 'Mart & Laszlo'],
      ['2026-08-04', 'Robin & Marley'], ['2026-09-01', 'Edward & Frency'],
      ['2026-10-06', null], ['2026-11-03', null], ['2026-12-01', null],
    ]);

    seedClinic('GGZ Delfland', 'GGZ Delfland', 'Om de 6 weken op dinsdag', '19:00–20:00', '', '', [
      ['2026-03-03', null], ['2026-04-14', 'Marley & Marco'],
      ['2026-05-26', 'Marley & Peter'], ['2026-07-07', 'Marley & Sonja'],
      ['2026-08-18', 'Marijn'], ['2026-09-29', 'Peet & Pieter'],
      ['2026-11-10', null], ['2026-12-22', null],
    ]);

    seedClinic('P.I. Hoogvliet', 'P.I. Hoogvliet', 'Elke laatste donderdag van de maand', '19:00–20:00', '', '', [
      ['2026-01-29', null], ['2026-02-26', null],
      ['2026-03-26', 'Peet & Marco'], ['2026-04-30', 'Casper & Jim'],
      ['2026-05-28', null], ['2026-06-25', 'Casper & Marijn'],
      ['2026-07-30', null], ['2026-08-27', null], ['2026-09-24', null],
      ['2026-10-29', null], ['2026-11-26', null], ['2026-12-26', null],
    ]);

    seedClinic('De Loods', 'De Loods', 'Elke eerste maandag van de maand', '20:00–21:00', '', '', [
      ['2026-01-05', null], ['2026-02-02', null], ['2026-03-02', null],
      ['2026-04-06', 'Jeroen & Dennis'], ['2026-05-04', 'Richard & Victor & Mathijs'],
      ['2026-06-01', 'Ernstjan & Marley'], ['2026-07-06', 'Dennis & Jeroen'],
      ['2026-08-03', null], ['2026-09-07', null], ['2026-10-05', null],
      ['2026-11-02', null], ['2026-12-07', null],
    ]);

    seedClinic('Castle Craig 070', 'Castle Craig 070', 'Om de 6 weken op dinsdag', '10:30–12:00', '', '', [
      ['2026-05-05', 'Jon & Ferry'], ['2026-06-16', 'Sonja & Machteld'],
      ['2026-07-28', 'Arjen & Johan'], ['2026-09-08', null],
      ['2026-10-20', null], ['2026-12-01', null], ['2027-01-12', null],
    ]);
  });
  seed();
  console.log('Voorbeelddata geladen (8 klinieken).');
}

// ─── Queries ───────────────────────────────────────────────────────────────

// Beperk een query tot bepaalde klinieken. ids = null betekent: alle klinieken.
function clinicFilter(ids, column) {
  if (ids === null || ids === undefined) return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

const queries = {
  // Public
  getClinics() {
    const clinics = db.prepare('SELECT * FROM clinics WHERE active = 1 ORDER BY name').all();
    const getDates = db.prepare(`
      SELECT d.id, d.date, d.status,
        r.id as reg_id,
        GROUP_CONCAT(p.first_name, ' & ') as first_names
      FROM dates d
      LEFT JOIN registrations r ON r.date_id = d.id AND r.status = 'approved'
      LEFT JOIN persons p ON p.registration_id = r.id
      WHERE d.clinic_id = ?
      GROUP BY d.id
      ORDER BY d.date ASC
    `);
    return clinics.map(c => ({ ...c, dates: getDates.all(c.id) }));
  },

  getClinicById(id) {
    return db.prepare('SELECT * FROM clinics WHERE id = ?').get(id);
  },

  getDateById(id) {
    return db.prepare('SELECT * FROM dates WHERE id = ?').get(id);
  },

  createRegistration(date_id, persons) {
    const result = db.transaction(() => {
      db.prepare("UPDATE dates SET status = 'pending' WHERE id = ?").run(date_id);
      const reg = db.prepare("INSERT INTO registrations (date_id, status) VALUES (?, 'pending')").run(date_id);
      const insertPerson = db.prepare(
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile, educator_id) VALUES (?,?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(reg.lastInsertRowid, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '', educatorHelpers.findOrCreate(p));
      });
      return reg.lastInsertRowid;
    })();
    return result;
  },

  adminCreateRegistration(date_id, persons) {
    // Direct goedgekeurd aanmaken — voor admins
    const result = db.transaction(() => {
      db.prepare("UPDATE dates SET status = 'approved' WHERE id = ?").run(date_id);
      const reg = db.prepare("INSERT INTO registrations (date_id, status) VALUES (?, 'approved')").run(date_id);
      const insertPerson = db.prepare(
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile, educator_id) VALUES (?,?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(reg.lastInsertRowid, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '', educatorHelpers.findOrCreate(p));
      });
      return reg.lastInsertRowid;
    })();
    return result;
  },

  // Admin – Queue
  getQueue(clinicIds = null) {
    const f = clinicFilter(clinicIds, 'c.id');
    const regs = db.prepare(`
      SELECT r.id, r.created_at, r.status,
        d.id as date_id, d.date, d.status as date_status,
        c.id as clinic_id, c.name as clinic_name, c.time, c.address
      FROM registrations r
      JOIN dates d ON d.id = r.date_id
      JOIN clinics c ON c.id = d.clinic_id
      WHERE r.status = 'pending'${f.sql}
      ORDER BY d.date ASC, r.created_at ASC
    `).all(...f.params);
    const getPersons = db.prepare('SELECT * FROM persons WHERE registration_id = ? ORDER BY person_number');
    const out = regs.map(r => ({ ...r, persons: getPersons.all(r.id) }));
    educatorHelpers.attachExperience(out.flatMap(r => r.persons));
    return out;
  },

  approveRegistration(id) {
    db.transaction(() => {
      const reg = db.prepare('SELECT date_id FROM registrations WHERE id = ?').get(id);
      if (!reg) return;
      db.prepare("UPDATE registrations SET status = 'approved' WHERE id = ?").run(id);
      db.prepare("UPDATE dates SET status = 'approved' WHERE id = ?").run(reg.date_id);
    })();
  },

  rejectRegistration(id) {
    db.transaction(() => {
      const reg = db.prepare('SELECT date_id FROM registrations WHERE id = ?').get(id);
      if (!reg) return;
      db.prepare("UPDATE registrations SET status = 'rejected' WHERE id = ?").run(id);
      db.prepare("UPDATE dates SET status = 'free' WHERE id = ?").run(reg.date_id);
    })();
  },

  // Admin – Clinics
  getAllClinics(clinicIds = null) {
    const f = clinicFilter(clinicIds, 'c.id');
    const clinics = db.prepare(`
      SELECT c.*, u.username AS manager_name
      FROM clinics c LEFT JOIN users u ON u.id = c.manager_id
      WHERE 1=1${f.sql}
      ORDER BY c.name
    `).all(...f.params);
    const getDates = db.prepare(`
      SELECT d.id, d.date, d.status,
        r.id as reg_id,
        GROUP_CONCAT(p.first_name || ' ' || p.last_name, ' & ') as names
      FROM dates d
      LEFT JOIN registrations r ON r.date_id = d.id AND r.status IN ('pending','approved')
      LEFT JOIN persons p ON p.registration_id = r.id
      WHERE d.clinic_id = ?
      GROUP BY d.id
      ORDER BY d.date ASC
    `);
    return clinics.map(c => ({ ...c, dates: getDates.all(c.id) }));
  },

  createClinic(data) {
    return db.prepare(
      'INSERT INTO clinics (name, address, frequency, time, contact_name, contact_info, allow_public_signup, manager_id, type) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(data.name, data.address || '', data.frequency || '', data.time || '', data.contact_name || '', data.contact_info || '', data.allow_public_signup !== false ? 1 : 0, data.manager_id || null,
      ['kliniek', 'pi'].includes(data.type) ? data.type : guessClinicType(data.name));
  },

  updateClinic(id, data) {
    // manager_id niet meegestuurd = ongewijzigd laten
    const existing = db.prepare('SELECT manager_id, type FROM clinics WHERE id = ?').get(id);
    const managerId = data.manager_id === undefined ? (existing ? existing.manager_id : null) : (data.manager_id || null);
    const type = ['kliniek', 'pi'].includes(data.type) ? data.type : (existing ? existing.type : 'kliniek');
    return db.transaction(() => {
      const res = db.prepare(
        'UPDATE clinics SET name=?, address=?, frequency=?, time=?, contact_name=?, contact_info=?, allow_public_signup=?, manager_id=?, type=? WHERE id=?'
      ).run(data.name, data.address || '', data.frequency || '', data.time || '', data.contact_name || '', data.contact_info || '', data.allow_public_signup !== false ? 1 : 0, managerId, type, id);
      // Houd de geschiedenis gelijk met de naam en het soort van de kliniek.
      db.prepare('UPDATE OR IGNORE educator_sessions SET clinic_name = ?, clinic_type = ? WHERE clinic_id = ?').run(data.name, type, id);
      return res;
    })();
  },

  deleteClinic(id) {
    return db.transaction(() => {
      educatorHelpers.archive('c.id = ? AND d.date <= ?', [id, todayISO()]);
      const res = db.prepare('DELETE FROM clinics WHERE id = ?').run(id);
      educatorHelpers.gc();
      return res;
    })();
  },

  addDate(clinic_id, date) {
    const existing = db.prepare('SELECT id FROM dates WHERE clinic_id = ? AND date = ?').get(clinic_id, date);
    if (existing) return null;
    return db.prepare("INSERT INTO dates (clinic_id, date, status) VALUES (?, ?, 'free')").run(clinic_id, date);
  },

  clearDate(date_id) {
    db.transaction(() => {
      db.prepare("UPDATE registrations SET status = 'rejected' WHERE date_id = ? AND status IN ('pending','approved')").run(date_id);
      db.prepare("UPDATE dates SET status = 'free' WHERE id = ?").run(date_id);
    })();
  },

  deleteDate(date_id) {
    db.transaction(() => {
      educatorHelpers.archive('d.id = ? AND d.date <= ?', [date_id, todayISO()]);
      db.prepare('DELETE FROM dates WHERE id = ?').run(date_id);
      educatorHelpers.gc();
    })();
  },

  countPastDates(today) {
    return db.prepare('SELECT COUNT(*) AS n FROM dates WHERE date < ?').get(today).n;
  },

  deletePastDates(today) {
    return db.transaction(() => {
      educatorHelpers.archive('d.date < ?', [today]);
      const n = db.prepare('DELETE FROM dates WHERE date < ?').run(today).changes;
      educatorHelpers.gc();
      return n;
    })();
  },

  getDateStringsForClinic(clinic_id) {
    return db.prepare('SELECT date FROM dates WHERE clinic_id = ? ORDER BY date ASC').all(clinic_id).map(r => r.date);
  },

  generateDates(clinic_id, dates) {
    return db.transaction(() => {
      const added = [];
      dates.forEach(date => {
        if (queries.addDate(clinic_id, date)) added.push(date);
      });
      return added;
    })();
  },

  // Admin – Week overview
  setClinicNotified(dateId, value) {
    db.prepare('UPDATE dates SET clinic_notified = ? WHERE id = ?').run(value ? 1 : 0, dateId);
  },

  getWeekDates(startISO, endISO, clinicIds = null) {
    const f = clinicFilter(clinicIds, 'c.id');
    const dates = db.prepare(`
      SELECT d.id, d.date, d.status, d.clinic_notified,
        c.id as clinic_id, c.name as clinic_name, c.address, c.time,
        c.contact_name, c.contact_info,
        r.id as reg_id
      FROM dates d
      JOIN clinics c ON c.id = d.clinic_id
      LEFT JOIN registrations r ON r.date_id = d.id AND r.status = 'approved'
      WHERE d.date >= ? AND d.date <= ?${f.sql}
      ORDER BY d.date ASC, c.name ASC
    `).all(startISO, endISO, ...f.params);

    const getPersons = db.prepare('SELECT * FROM persons WHERE registration_id = ? ORDER BY person_number');
    const out = dates.map(d => ({
      ...d,
      persons: d.reg_id ? getPersons.all(d.reg_id) : [],
    }));
    educatorHelpers.attachExperience(out.flatMap(d => d.persons));
    return out;
  },

  updateRegistration(id, persons) {
    db.transaction(() => {
      db.prepare('DELETE FROM persons WHERE registration_id = ?').run(id);
      const insertPerson = db.prepare(
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile, educator_id) VALUES (?,?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(id, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '', educatorHelpers.findOrCreate(p));
      });
      educatorHelpers.gc();
    })();
  },

  // Voorlichters
  getEducators() {
    const today = todayISO();
    const eds = db.prepare('SELECT * FROM educators ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE').all();
    const exp = educatorHelpers.experience(null);
    const counts = {};
    db.prepare(`
      SELECT p.educator_id, r.status, d.date, r.id AS rid FROM persons p
      JOIN registrations r ON r.id = p.registration_id
      JOIN dates d ON d.id = r.date_id
      WHERE r.status IN ('pending','approved') AND p.educator_id IS NOT NULL
    `).all().forEach(r => {
      const c = counts[r.educator_id] || (counts[r.educator_id] = { pending: 0, upcoming: 0 });
      if (r.status === 'pending') c.pending++; else if (r.date > today) c.upcoming++;
    });
    return eds.map(e => {
      const x = exp.get(e.id) || { kliniek: 0, pi: 0, total: 0, last_date: null, places: [] };
      const c = counts[e.id] || { pending: 0, upcoming: 0 };
      return {
        id: e.id, first_name: e.first_name, last_name: e.last_name, birth_date: e.birth_date, phone: e.phone,
        prior_kliniek: e.prior_kliniek, prior_pi: e.prior_pi,
        kliniek: x.kliniek, pi: x.pi, total: x.total, experienced: x.total > 0,
        last_date: x.last_date, places: x.places, pending: c.pending, upcoming: c.upcoming,
        incomplete: !e.last_name || !e.birth_date || !e.phone,
      };
    });
  },

  getEducatorById(id) {
    return db.prepare('SELECT * FROM educators WHERE id = ?').get(id);
  },

  updateEducator(id, d) {
    db.transaction(() => {
      db.prepare(`UPDATE educators SET first_name=?, last_name=?, birth_date=?, phone=?, prior_kliniek=?, prior_pi=? WHERE id=?`)
        .run(d.first_name, d.last_name, normBirth(d.birth_date), d.phone, d.prior_kliniek, d.prior_pi, id);
      // Zorg dat de nieuwe schrijfwijze ook herkend wordt; de oude blijft herkend.
      const nameKey = normText(d.first_name) + '|' + normText(d.last_name);
      const birth = normBirth(d.birth_date);
      db.prepare('INSERT OR IGNORE INTO educator_keys (key, name_key, birth_date, educator_id) VALUES (?,?,?,?)')
        .run(nameKey + '|' + birth, nameKey, birth, id);
    })();
  },

  // Voeg profiel 'source' samen met 'target': aanmeldingen, geschiedenis en aantallen gaan mee.
  mergeEducators(sourceId, targetId) {
    db.transaction(() => {
      const s = db.prepare('SELECT * FROM educators WHERE id = ?').get(sourceId);
      db.prepare('UPDATE persons SET educator_id = ? WHERE educator_id = ?').run(targetId, sourceId);
      db.prepare('UPDATE OR IGNORE educator_sessions SET educator_id = ? WHERE educator_id = ?').run(targetId, sourceId);
      db.prepare('UPDATE educator_keys SET educator_id = ? WHERE educator_id = ?').run(targetId, sourceId);
      db.prepare(`UPDATE educators SET
        prior_kliniek = prior_kliniek + ?, prior_pi = prior_pi + ?,
        birth_date = CASE WHEN birth_date = '' THEN ? ELSE birth_date END,
        phone = CASE WHEN phone = '' THEN ? ELSE phone END
        WHERE id = ?`).run(s.prior_kliniek, s.prior_pi, s.birth_date, s.phone, targetId);
      db.prepare('DELETE FROM educators WHERE id = ?').run(sourceId);
    })();
  },

  // Profiel verwijderen. De bijbehorende aanmeldingen blijven bestaan maar krijgen geen nieuw profiel.
  deleteEducator(id) {
    db.transaction(() => {
      db.prepare('UPDATE persons SET educator_id = NULL, no_profile = 1 WHERE educator_id = ?').run(id);
      db.prepare('DELETE FROM educators WHERE id = ?').run(id);
    })();
  },

  // Auth
  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  listUsers() {
    const users = db.prepare('SELECT id, username, role, must_change_password FROM users ORDER BY username COLLATE NOCASE').all();
    const getClinics = db.prepare('SELECT id, name FROM clinics WHERE manager_id = ? ORDER BY name');
    return users.map(u => ({ ...u, clinics: getClinics.all(u.id) }));
  },

  createUser(username, passwordHash, role) {
    return db.prepare('INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?,?,?,1)')
      .run(username, passwordHash, role);
  },

  setPassword(id, passwordHash, mustChange) {
    return db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
      .run(passwordHash, mustChange ? 1 : 0, id);
  },

  countAdmins() {
    return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  },

  deleteUser(id) {
    db.transaction(() => {
      db.prepare('UPDATE clinics SET manager_id = NULL WHERE manager_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    })();
  },

  getManagedClinics(userId) {
    return db.prepare('SELECT id, name FROM clinics WHERE manager_id = ? ORDER BY name').all(userId);
  },

  getClinicIdForDate(dateId) {
    const r = db.prepare('SELECT clinic_id FROM dates WHERE id = ?').get(dateId);
    return r ? r.clinic_id : null;
  },

  getClinicIdForRegistration(regId) {
    const r = db.prepare('SELECT d.clinic_id FROM registrations r JOIN dates d ON d.id = r.date_id WHERE r.id = ?').get(regId);
    return r ? r.clinic_id : null;
  },

  getRegistrationById(id) {
    const reg = db.prepare(`
      SELECT r.*, d.date, d.status as date_status,
        c.name as clinic_name, c.time, c.address, c.contact_name, c.contact_info
      FROM registrations r
      JOIN dates d ON d.id = r.date_id
      JOIN clinics c ON c.id = d.clinic_id
      WHERE r.id = ?
    `).get(id);
    if (reg) {
      reg.persons = db.prepare('SELECT * FROM persons WHERE registration_id = ? ORDER BY person_number').all(id);
    }
    return reg;
  },
};

module.exports = { initDb, queries, db, educatorHelpers, guessClinicType, todayISO };
