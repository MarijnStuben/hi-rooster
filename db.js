const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hi-rooster.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('admin', bcrypt.hashSync('admin123', 10));
    console.log('Standaard admin aangemaakt: gebruikersnaam=admin wachtwoord=admin123');
  }

  const count = db.prepare('SELECT COUNT(*) as n FROM clinics').get();
  if (count.n === 0) seedData();
}

function seedClinic(name, address, frequency, time, contact_name, contact_info, datesData) {
  const clinic = db.prepare(
    'INSERT INTO clinics (name, address, frequency, time, contact_name, contact_info) VALUES (?,?,?,?,?,?)'
  ).run(name, address, frequency, time, contact_name, contact_info);

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
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile) VALUES (?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(reg.lastInsertRowid, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '');
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
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile) VALUES (?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(reg.lastInsertRowid, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '');
      });
      return reg.lastInsertRowid;
    })();
    return result;
  },

  // Admin – Queue
  getQueue() {
    const regs = db.prepare(`
      SELECT r.id, r.created_at, r.status,
        d.id as date_id, d.date, d.status as date_status,
        c.id as clinic_id, c.name as clinic_name, c.time, c.address
      FROM registrations r
      JOIN dates d ON d.id = r.date_id
      JOIN clinics c ON c.id = d.clinic_id
      WHERE r.status = 'pending'
      ORDER BY d.date ASC, r.created_at ASC
    `).all();
    const getPersons = db.prepare('SELECT * FROM persons WHERE registration_id = ? ORDER BY person_number');
    return regs.map(r => ({ ...r, persons: getPersons.all(r.id) }));
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
  getAllClinics() {
    const clinics = db.prepare('SELECT * FROM clinics ORDER BY name').all();
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
      'INSERT INTO clinics (name, address, frequency, time, contact_name, contact_info, allow_public_signup) VALUES (?,?,?,?,?,?,?)'
    ).run(data.name, data.address || '', data.frequency || '', data.time || '', data.contact_name || '', data.contact_info || '', data.allow_public_signup !== false ? 1 : 0);
  },

  updateClinic(id, data) {
    return db.prepare(
      'UPDATE clinics SET name=?, address=?, frequency=?, time=?, contact_name=?, contact_info=?, allow_public_signup=? WHERE id=?'
    ).run(data.name, data.address || '', data.frequency || '', data.time || '', data.contact_name || '', data.contact_info || '', data.allow_public_signup !== false ? 1 : 0, id);
  },

  deleteClinic(id) {
    return db.prepare('DELETE FROM clinics WHERE id = ?').run(id);
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
    db.prepare('DELETE FROM dates WHERE id = ?').run(date_id);
  },

  // Admin – Week overview
  setClinicNotified(dateId, value) {
    db.prepare('UPDATE dates SET clinic_notified = ? WHERE id = ?').run(value ? 1 : 0, dateId);
  },

  getWeekDates(startISO, endISO) {
    const dates = db.prepare(`
      SELECT d.id, d.date, d.status, d.clinic_notified,
        c.id as clinic_id, c.name as clinic_name, c.address, c.time,
        c.contact_name, c.contact_info,
        r.id as reg_id
      FROM dates d
      JOIN clinics c ON c.id = d.clinic_id
      LEFT JOIN registrations r ON r.date_id = d.id AND r.status = 'approved'
      WHERE d.date >= ? AND d.date <= ?
      ORDER BY d.date ASC, c.name ASC
    `).all(startISO, endISO);

    const getPersons = db.prepare('SELECT * FROM persons WHERE registration_id = ? ORDER BY person_number');
    return dates.map(d => ({
      ...d,
      persons: d.reg_id ? getPersons.all(d.reg_id) : [],
    }));
  },

  updateRegistration(id, persons) {
    db.transaction(() => {
      db.prepare('DELETE FROM persons WHERE registration_id = ?').run(id);
      const insertPerson = db.prepare(
        'INSERT INTO persons (registration_id, person_number, first_name, last_name, birth_date, phone, mobile) VALUES (?,?,?,?,?,?,?)'
      );
      persons.forEach(p => {
        insertPerson.run(id, p.number, p.first_name, p.last_name, p.birth_date || '', p.phone || '', p.mobile || '');
      });
    })();
  },

  // Auth
  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
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

module.exports = { initDb, queries };
