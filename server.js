const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initDb, queries } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'hi-rooster-geheim-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 uur
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Niet ingelogd' });
}

// ─── Auth ──────────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vul gebruikersnaam en wachtwoord in.' });
  const user = queries.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

// ─── Public API ────────────────────────────────────────────────────────────

app.get('/api/clinics', (req, res) => {
  try {
    const clinics = queries.getClinics();
    clinics.forEach(c => {
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
  res.json(queries.getQueue());
});

app.patch('/api/admin/registrations/:id/approve', requireAuth, (req, res) => {
  queries.approveRegistration(Number(req.params.id));
  res.json({ ok: true });
});

app.patch('/api/admin/registrations/:id/reject', requireAuth, (req, res) => {
  queries.rejectRegistration(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/registrations/:id', requireAuth, (req, res) => {
  const reg = queries.getRegistrationById(Number(req.params.id));
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  res.json(reg);
});

app.put('/api/admin/registrations/:id', requireAuth, (req, res) => {
  const { persons } = req.body;
  if (!persons || !persons.length) return res.status(400).json({ error: 'Geen personen opgegeven.' });
  queries.updateRegistration(Number(req.params.id), persons);
  res.json({ ok: true });
});

app.post('/api/admin/dates/:id/register', requireAuth, (req, res) => {
  const { persons } = req.body;
  if (!persons || persons.length < 2) return res.status(400).json({ error: 'Minimaal 2 personen vereist.' });
  const date = queries.getDateById(Number(req.params.id));
  if (!date || date.status !== 'free') return res.status(409).json({ error: 'Datum is niet meer vrij.' });
  queries.adminCreateRegistration(Number(req.params.id), persons);
  res.json({ ok: true });
});

app.get('/api/admin/clinics', requireAuth, (req, res) => {
  res.json(queries.getAllClinics());
});

app.post('/api/admin/clinics', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht.' });
  const result = queries.createClinic(req.body);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/admin/clinics/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht.' });
  queries.updateClinic(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/admin/clinics/:id', requireAuth, (req, res) => {
  queries.deleteClinic(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/dates', requireAuth, (req, res) => {
  const { clinic_id, date } = req.body;
  if (!clinic_id || !date) return res.status(400).json({ error: 'Kliniek en datum zijn verplicht.' });
  const result = queries.addDate(Number(clinic_id), date);
  if (!result) return res.status(409).json({ error: 'Datum bestaat al voor deze kliniek.' });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/dates/:id/clear', requireAuth, (req, res) => {
  queries.clearDate(Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/admin/dates/:id', requireAuth, (req, res) => {
  queries.deleteDate(Number(req.params.id));
  res.json({ ok: true });
});

app.patch('/api/admin/dates/:id/notified', requireAuth, (req, res) => {
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
  const dates = queries.getWeekDates(toISO(startDate), toISO(endDate));
  res.json({ start: toISO(startDate), end: toISO(endDate), dates });
});

// ─── SPA fallbacks ─────────────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────────────

initDb();
app.listen(PORT, () => {
  console.log(`H&I Rooster draait op http://localhost:${PORT}`);
  console.log(`Adminpanel: http://localhost:${PORT}/admin`);
});
