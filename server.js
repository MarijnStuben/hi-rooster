const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { initDb, queries } = require('./db');
const { toLocalISO, resolveSchedule, generateDates, describe } = require('./schedule');

const BACKUP_DIR = path.join(__dirname, 'backups');
const DB_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'hi-rooster.db');
const MAX_BACKUPS = 14;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createBackup() {
  ensureBackupDir();
  const now = new Date();
  const stamp = now.toISOString().replace('T', '_').slice(0, 16).replace(':', '-');
  const filename = `backup-${stamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);
  const fd = fs.openSync(filepath, 'w');
  try {
    execFileSync('sqlite3', [DB_PATH, '.dump'], { stdio: ['pipe', fd, 'pipe'] });
  } finally {
    fs.closeSync(fd);
  }
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
    .sort();
  if (files.length > MAX_BACKUPS) {
    files.slice(0, files.length - MAX_BACKUPS)
      .forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  }
  return filename;
}

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Zonder SESSION_SECRET kiest de app bij elke start een willekeurige sleutel.
// Dat is veilig, maar beheerders worden dan bij elke herstart uitgelogd.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('Let op: SESSION_SECRET is niet gezet. Er wordt een tijdelijke sleutel gebruikt; na een herstart moet je opnieuw inloggen.');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 uur
}));

// Optionele API-sleutel voor beheer zonder in te loggen (bijv. vanuit Claude).
// Alleen actief als ADMIN_API_TOKEN is ingesteld (minimaal 32 tekens).
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
if (ADMIN_API_TOKEN && ADMIN_API_TOKEN.length < 32) {
  console.warn('ADMIN_API_TOKEN is te kort (minimaal 32 tekens) en wordt genegeerd.');
}

function hasValidApiToken(req) {
  if (ADMIN_API_TOKEN.length < 32) return false;
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const a = crypto.createHash('sha256').update(match[1].trim()).digest();
  const b = crypto.createHash('sha256').update(ADMIN_API_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Een sessie is alleen geldig zolang de gebruiker bestaat en het wachtwoord niet is
// gewijzigd of gereset sinds het inloggen.
function pwStamp(user) {
  return crypto.createHash('sha256').update(user.password_hash).digest('hex').slice(0, 16);
}

function authenticate(req) {
  if (req.session && req.session.userId) {
    const user = queries.getUserById(req.session.userId);
    if (user && req.session.pwv === pwStamp(user)) return user;
  }
  if (hasValidApiToken(req)) {
    return { id: null, username: 'api', role: 'admin', must_change_password: 0, viaToken: true };
  }
  return null;
}

// Ingelogd, ook als het wachtwoord nog gewijzigd moet worden.
function requireLogin(req, res, next) {
  const user = authenticate(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });
  req.user = user;
  next();
}

// Ingelogd en het wachtwoord is al gewijzigd.
function requireAuth(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user.must_change_password) {
      return res.status(403).json({ error: 'Je moet eerst je wachtwoord wijzigen.', must_change_password: true });
    }
    next();
  });
}

// Alleen beheerders met volledige rechten (Bob).
function adminOnly(req, res, next) {
  if (req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Dit mag alleen een beheerder met volledige rechten.' });
}

// Klinieken waar deze gebruiker bij mag: null = alle klinieken.
function scopeIds(user) {
  if (user.role === 'admin') return null;
  return queries.getManagedClinics(user.id).map(c => c.id);
}

function canAccessClinic(user, clinicId) {
  if (user.role === 'admin') return true;
  return queries.getManagedClinics(user.id).some(c => c.id === clinicId);
}

// Controleert of de gebruiker bij de kliniek van een datum of aanmelding mag.
function guardClinic(lookup) {
  return (req, res, next) => {
    const clinicId = lookup(Number(req.params.id));
    if (clinicId === null || clinicId === undefined) return res.status(404).json({ error: 'Niet gevonden.' });
    if (!canAccessClinic(req.user, clinicId)) {
      return res.status(403).json({ error: 'Dit is niet een van jouw klinieken.' });
    }
    next();
  };
}
const guardDate = guardClinic(id => queries.getClinicIdForDate(id));
const guardRegistration = guardClinic(id => queries.getClinicIdForRegistration(id));
const guardClinicParam = guardClinic(id => (queries.getClinicById(id) ? id : null));

// ─── Auth ──────────────────────────────────────────────────────────────────

// Eenvoudige rem op wachtwoorden raden: na 10 mislukte pogingen binnen
// 15 minuten wordt een IP-adres tijdelijk geblokkeerd.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFails = new Map();

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const entry = loginFails.get(ip);
  if (entry && now - entry.first > LOGIN_WINDOW_MS) loginFails.delete(ip);
  const fails = loginFails.get(ip);
  if (fails && fails.count >= LOGIN_MAX_FAILS) {
    return res.status(429).json({ error: 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.' });
  }

  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Vul gebruikersnaam en wachtwoord in.' });
  }
  const user = queries.getUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    if (fails) fails.count++; else loginFails.set(ip, { count: 1, first: now });
    return res.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  }
  loginFails.delete(ip);
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.pwv = pwStamp(user);
  res.json({ ok: true, username: user.username, role: user.role, must_change_password: !!user.must_change_password });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/admin/me', requireLogin, (req, res) => {
  const u = req.user;
  res.json({
    username: u.username,
    role: u.role,
    must_change_password: !!u.must_change_password,
    clinics: u.id ? queries.getManagedClinics(u.id) : [],
  });
});

const MIN_PASSWORD = 8;
function passwordProblem(password, username) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Het wachtwoord moet minimaal ${MIN_PASSWORD} tekens hebben.`;
  if (Buffer.byteLength(password) > 72) return 'Het wachtwoord mag maximaal 72 tekens zijn.';
  if (username && password.toLowerCase() === String(username).toLowerCase()) return 'Het wachtwoord mag niet gelijk zijn aan de gebruikersnaam.';
  return null;
}

// Eigen wachtwoord wijzigen (ook verplicht bij de eerste keer inloggen).
app.post('/api/admin/change-password', requireLogin, (req, res) => {
  if (!req.user.id) return res.status(400).json({ error: 'Niet beschikbaar voor de API-sleutel.' });
  const ip = req.ip;
  const fails = loginFails.get(ip);
  if (fails && fails.count >= LOGIN_MAX_FAILS) {
    return res.status(429).json({ error: 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.' });
  }
  const { current_password, new_password } = req.body;
  if (typeof current_password !== 'string' || !bcrypt.compareSync(current_password, req.user.password_hash)) {
    if (fails) fails.count++; else loginFails.set(ip, { count: 1, first: Date.now() });
    return res.status(401).json({ error: 'Je huidige wachtwoord klopt niet.' });
  }
  const problem = passwordProblem(new_password, req.user.username);
  if (problem) return res.status(400).json({ error: problem });
  if (new_password === current_password) return res.status(400).json({ error: 'Kies een ander wachtwoord dan je huidige.' });
  const hash = bcrypt.hashSync(new_password, 10);
  queries.setPassword(req.user.id, hash, false);
  req.session.pwv = pwStamp({ password_hash: hash });
  res.json({ ok: true });
});

// ─── Public API ────────────────────────────────────────────────────────────

app.get('/api/clinics', (req, res) => {
  try {
    const clinics = queries.getClinics();
    clinics.forEach(c => {
      delete c.manager_id;
      c.dates.forEach(d => {
        // Approved: toon voornamen; pending: verberg namen
        if (d.status === 'pending') {
          d.first_names = null;
        }
        // first_names blijft staan voor approved datums
      });
    });
    res.json(clinics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfout' });
  }
});

app.post('/api/registrations', (req, res) => {
  try {
    const { date_id, persons } = req.body;
    if (!date_id || !persons || persons.length < 2) {
      return res.status(400).json({ error: 'Ongeldige aanmelding.' });
    }

    const date = queries.getDateById(date_id);
    if (!date || date.status !== 'free') {
      return res.status(409).json({ error: 'Deze datum is niet meer beschikbaar.' });
    }

    // Validate person 1
    const p1 = persons.find(p => p.number === 1);
    if (!p1 || !p1.first_name || !p1.last_name || !p1.phone) {
      return res.status(400).json({ error: 'Vul alle verplichte velden in voor persoon 1.' });
    }
    // Validate person 2
    const p2 = persons.find(p => p.number === 2);
    if (!p2 || !p2.first_name || !p2.last_name || !p2.birth_date) {
      return res.status(400).json({ error: 'Vul alle verplichte velden in voor persoon 2 (voornaam, achternaam en geboortedatum).' });
    }

    queries.createRegistration(date_id, persons);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfout' });
  }
});

// ─── Admin API ─────────────────────────────────────────────────────────────

app.get('/api/admin/queue', requireAuth, (req, res) => {
  res.json(queries.getQueue(scopeIds(req.user)));
});

app.patch('/api/admin/registrations/:id/approve', requireAuth, guardRegistration, (req, res) => {
  queries.approveRegistration(Number(req.params.id));
  res.json({ ok: true });
});

app.patch('/api/admin/registrations/:id/reject', requireAuth, guardRegistration, (req, res) => {
  queries.rejectRegistration(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/registrations/:id', requireAuth, guardRegistration, (req, res) => {
  const reg = queries.getRegistrationById(Number(req.params.id));
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  res.json(reg);
});

app.put('/api/admin/registrations/:id', requireAuth, guardRegistration, (req, res) => {
  const { persons } = req.body;
  if (!persons || !persons.length) return res.status(400).json({ error: 'Geen personen opgegeven.' });
  queries.updateRegistration(Number(req.params.id), persons);
  res.json({ ok: true });
});

app.post('/api/admin/dates/:id/register', requireAuth, guardDate, (req, res) => {
  const { persons } = req.body;
  if (!persons || persons.length < 2) return res.status(400).json({ error: 'Minimaal 2 personen vereist.' });
  const date = queries.getDateById(Number(req.params.id));
  if (!date || date.status !== 'free') return res.status(409).json({ error: 'Datum is niet meer vrij.' });
  queries.adminCreateRegistration(Number(req.params.id), persons);
  res.json({ ok: true });
});

app.get('/api/admin/clinics', requireAuth, (req, res) => {
  res.json(queries.getAllClinics(scopeIds(req.user)));
});

// Controleert dat manager_id (indien meegestuurd) een bestaande gebruiker is.
function managerProblem(body) {
  if (body.manager_id === undefined || body.manager_id === null || body.manager_id === '') return null;
  const id = Number(body.manager_id);
  if (!Number.isInteger(id) || !queries.getUserById(id)) return 'De gekozen verantwoordelijke bestaat niet.';
  body.manager_id = id;
  return null;
}

app.post('/api/admin/clinics', requireAuth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht.' });
  const problem = managerProblem(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const result = queries.createClinic(req.body);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/admin/clinics/:id', requireAuth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht.' });
  const problem = managerProblem(req.body);
  if (problem) return res.status(400).json({ error: problem });
  queries.updateClinic(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/admin/clinics/:id', requireAuth, adminOnly, (req, res) => {
  queries.deleteClinic(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/dates', requireAuth, (req, res) => {
  const { clinic_id, date } = req.body;
  if (!clinic_id || !date) return res.status(400).json({ error: 'Kliniek en datum zijn verplicht.' });
  if (!canAccessClinic(req.user, Number(clinic_id))) {
    return res.status(403).json({ error: 'Dit is niet een van jouw klinieken.' });
  }
  const result = queries.addDate(Number(clinic_id), date);
  if (!result) return res.status(409).json({ error: 'Datum bestaat al voor deze kliniek.' });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/dates/:id/clear', requireAuth, guardDate, (req, res) => {
  queries.clearDate(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/clinics/:id/generate-dates', requireAuth, guardClinicParam, (req, res) => {
  const clinicId = Number(req.params.id);
  const clinic = queries.getClinicById(clinicId);
  if (!clinic) return res.status(404).json({ error: 'Kliniek niet gevonden.' });

  const today = new Date();
  const todayISO = toLocalISO(today);
  const maxISO = toLocalISO(new Date(today.getFullYear() + 3, today.getMonth(), today.getDate()));
  const until = req.body.until;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '') || until < todayISO || until > maxISO) {
    return res.status(400).json({ error: 'Vul een einddatum in de komende 3 jaar in.' });
  }

  const dates = queries.getDateStringsForClinic(clinicId);
  if (!dates.length) {
    return res.status(400).json({ error: 'Deze kliniek heeft nog geen datums om vanaf te plannen.' });
  }

  let rule;
  let warnings = [];
  if (req.body.interval_days) {
    const days = Number(req.body.interval_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'Interval moet tussen 1 en 365 dagen zijn.' });
    }
    rule = { kind: 'interval', days, weekday: null, source: 'handmatig' };
  } else {
    const resolved = resolveSchedule(clinic.frequency, dates);
    if (!resolved) {
      return res.status(400).json({ error: 'Geen patroon gevonden in de omschrijving of in de historie. Vul een interval in.' });
    }
    rule = resolved.rule;
    warnings = resolved.warnings;
  }

  const existing = new Set(dates);
  const candidates = generateDates(rule, dates, until)
    .filter(d => d >= todayISO && !existing.has(d));
  const info = { rule: describe(rule), source: rule.source, warnings };

  if (req.body.dry_run) return res.json({ ...info, dates: candidates });
  res.json({ ok: true, ...info, added: queries.generateDates(clinicId, candidates) });
});

app.delete('/api/admin/dates/past', requireAuth, adminOnly, (req, res) => {
  try {
    const backup = createBackup();
    const deleted = queries.deletePastDates(toLocalISO(new Date()));
    res.json({ ok: true, deleted, backup });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Backup mislukt, er is niets verwijderd.' });
  }
});

app.delete('/api/admin/dates/:id', requireAuth, guardDate, (req, res) => {
  queries.deleteDate(Number(req.params.id));
  res.json({ ok: true });
});

app.patch('/api/admin/dates/:id/notified', requireAuth, guardDate, (req, res) => {
  queries.setClinicNotified(Number(req.params.id), req.body.value);
  res.json({ ok: true });
});

app.get('/api/admin/week', requireAuth, (req, res) => {
  const { start } = req.query;
  let startDate;
  if (start) {
    startDate = new Date(start);
  } else {
    startDate = new Date();
    const day = startDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    startDate.setDate(startDate.getDate() + diff);
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const toISO = d => d.toISOString().slice(0, 10);
  const dates = queries.getWeekDates(toISO(startDate), toISO(endDate), scopeIds(req.user));
  res.json({ start: toISO(startDate), end: toISO(endDate), dates });
});

// ─── Gebruikers (alleen beheerder met volledige rechten) ────────────────────

app.get('/api/admin/users', requireAuth, adminOnly, (req, res) => {
  res.json(queries.listUsers());
});

app.post('/api/admin/users', requireAuth, adminOnly, (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const { password } = req.body;
  const role = req.body.role === 'admin' ? 'admin' : 'manager';
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: 'Gebruikersnaam: 3 tot 40 tekens, alleen letters, cijfers, punt, streepje of underscore.' });
  }
  const problem = passwordProblem(password, username);
  if (problem) return res.status(400).json({ error: problem });
  if (queries.getUserByUsername(username)) {
    return res.status(409).json({ error: 'Deze gebruikersnaam bestaat al.' });
  }
  const result = queries.createUser(username, bcrypt.hashSync(password, 10), role);
  console.log(`Gebruiker aangemaakt: ${username} (${role}) door ${req.user.username}`);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, adminOnly, (req, res) => {
  const user = queries.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
  const problem = passwordProblem(req.body.password, user.username);
  if (problem) return res.status(400).json({ error: problem });
  // Tijdelijk wachtwoord: de gebruiker moet het bij het volgende inloggen wijzigen.
  queries.setPassword(user.id, bcrypt.hashSync(req.body.password, 10), true);
  console.log(`Wachtwoord gereset: ${user.username} door ${req.user.username}`);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, adminOnly, (req, res) => {
  const user = queries.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
  if (req.user.id === user.id) return res.status(400).json({ error: 'Je kunt jezelf niet verwijderen.' });
  if (user.role === 'admin' && queries.countAdmins() <= 1) {
    return res.status(400).json({ error: 'De laatste beheerder met volledige rechten kan niet worden verwijderd.' });
  }
  queries.deleteUser(user.id);
  console.log(`Gebruiker verwijderd: ${user.username} door ${req.user.username}`);
  res.json({ ok: true });
});

// ─── Voorlichters (alleen beheerder met volledige rechten) ──────────────────

app.get('/api/admin/educators', requireAuth, adminOnly, (req, res) => {
  res.json(queries.getEducators());
});

function educatorInput(body) {
  const clean = v => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const count = v => { const n = Number(v === '' || v === undefined || v === null ? 0 : v); return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null; };
  const d = {
    first_name: clean(body.first_name), last_name: clean(body.last_name),
    birth_date: clean(body.birth_date), phone: clean(body.phone),
    prior_kliniek: count(body.prior_kliniek), prior_pi: count(body.prior_pi),
  };
  if (!d.first_name && !d.last_name) return { error: 'Vul minimaal een voornaam of achternaam in.' };
  if (d.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.birth_date)) return { error: 'Geboortedatum is ongeldig.' };
  if (d.prior_kliniek === null || d.prior_pi === null) return { error: 'Aantallen moeten hele getallen tussen 0 en 1000 zijn.' };
  return { data: d };
}

app.put('/api/admin/educators/:id', requireAuth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!queries.getEducatorById(id)) return res.status(404).json({ error: 'Voorlichter niet gevonden.' });
  const { data, error } = educatorInput(req.body);
  if (error) return res.status(400).json({ error });
  queries.updateEducator(id, data);
  res.json({ ok: true });
});

app.post('/api/admin/educators/:id/merge', requireAuth, adminOnly, (req, res) => {
  const sourceId = Number(req.params.id), targetId = Number(req.body.target_id);
  if (!queries.getEducatorById(sourceId) || !queries.getEducatorById(targetId)) {
    return res.status(404).json({ error: 'Voorlichter niet gevonden.' });
  }
  if (sourceId === targetId) return res.status(400).json({ error: 'Kies een ander profiel om mee samen te voegen.' });
  queries.mergeEducators(sourceId, targetId);
  console.log(`Voorlichters samengevoegd: ${sourceId} -> ${targetId} door ${req.user.username}`);
  res.json({ ok: true });
});

app.delete('/api/admin/educators/:id', requireAuth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!queries.getEducatorById(id)) return res.status(404).json({ error: 'Voorlichter niet gevonden.' });
  queries.deleteEducator(id);
  console.log(`Voorlichtersprofiel verwijderd: ${id} door ${req.user.username}`);
  res.json({ ok: true });
});

// ─── Backups ───────────────────────────────────────────────────────────────

app.get('/api/admin/backups', requireAuth, adminOnly, (req, res) => {
  ensureBackupDir();
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: stat.size, created: stat.mtime };
      });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Fout bij ophalen backups.' });
  }
});

app.post('/api/admin/backups', requireAuth, adminOnly, (req, res) => {
  try {
    const filename = createBackup();
    const stat = fs.statSync(path.join(BACKUP_DIR, filename));
    res.json({ ok: true, filename, size: stat.size, created: stat.mtime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Backup aanmaken mislukt.' });
  }
});

app.get('/api/admin/backups/:filename', requireAuth, adminOnly, (req, res) => {
  const { filename } = req.params;
  if (!/^backup-[\d_-]+\.sql$/.test(filename)) {
    return res.status(400).json({ error: 'Ongeldig bestandsnaam.' });
  }
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Niet gevonden.' });
  res.download(filepath, filename);
});

// ─── SPA fallbacks ─────────────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────────────

function cleanupPastDates() {
  const today = toLocalISO(new Date());
  if (!queries.countPastDates(today)) return;
  try {
    const backup = createBackup();
    const deleted = queries.deletePastDates(today);
    console.log(`Wekelijkse opschoning: ${deleted} gepasseerde datums verwijderd (backup: ${backup}).`);
  } catch (err) {
    console.error('Wekelijkse opschoning mislukt, er is niets verwijderd:', err);
  }
}

initDb();
app.listen(PORT, () => {
  console.log(`H&I Rooster draait op http://localhost:${PORT}`);
  console.log(`Adminpanel: http://localhost:${PORT}/admin`);
});
setInterval(() => {
  if (new Date().getDay() === 1) cleanupPastDates();
}, 60 * 60 * 1000);
