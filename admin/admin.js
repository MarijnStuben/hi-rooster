// ─── State ──────────────────────────────────────────────────────────────────
let currentView = 'queue';
let currentWeekStart = null;

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/admin/me');
    if (res.ok) {
      const data = await res.json();
      showAdminPanel(data.username);
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-panel').classList.add('hidden');
}

function showAdminPanel(username) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-panel').classList.remove('hidden');
  document.getElementById('nav-username').textContent = username;
  switchView('queue');
}

// ─── Login ───────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Bezig…';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      showAdminPanel(data.username);
    } else {
      errEl.textContent = data.error;
      errEl.classList.remove('hidden');
    }
  } catch {
    errEl.textContent = 'Verbindingsfout. Probeer opnieuw.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Inloggen';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLoginScreen();
});

// ─── Navigation ──────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  if (view === 'queue') loadQueue();
  else if (view === 'clinics') loadClinics();
  else if (view === 'week') loadWeek(currentWeekStart);
  else if (view === 'backups') loadBackups();
}

// ─── Queue ───────────────────────────────────────────────────────────────────
async function loadQueue() {
  const el = document.getElementById('queue-content');
  el.innerHTML = '<div style="color:var(--grey);padding:20px">Laden…</div>';
  try {
    const res = await fetch('/api/admin/queue');
    const items = await res.json();
    renderQueue(items);
    updateQueueBadge(items.length);
  } catch {
    el.innerHTML = '<div style="color:var(--red)">Fout bij laden van wachtrij.</div>';
  }
}

function updateQueueBadge(count) {
  const badge = document.getElementById('queue-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderQueue(items) {
  const el = document.getElementById('queue-content');
  if (!items.length) {
    el.innerHTML = '<div class="empty-state">Geen aanmeldingen in de wachtrij.</div>';
    return;
  }
  el.innerHTML = items.map(item => `
    <div class="queue-card" id="qcard-${item.id}">
      <div class="queue-header">
        <div class="queue-info">
          <h3>${esc(item.clinic_name)}</h3>
          <div class="queue-sub">
            ${fmtDateFull(item.date)} &bull; ${esc(item.time || '—')} &bull; ${esc(item.address || '—')}
          </div>
          <div class="queue-sub" style="margin-top:2px;color:var(--grey);font-size:.8rem">
            Aangemeld: ${fmtDateTime(item.created_at)}
          </div>
        </div>
        <div class="queue-actions">
          <button class="btn-success" onclick="approveReg(${item.id})">✓ Goedkeuren</button>
          <button class="btn-secondary" style="font-size:.8rem;padding:6px 12px" onclick="openEditRegModal(${item.id})">Bewerken</button>
          <button class="btn-danger" onclick="rejectReg(${item.id})">✗ Afwijzen</button>
        </div>
      </div>
      <div class="queue-body">
        <div class="persons-list">
          ${item.persons.map(p => `
            <div class="person-row">
              <div class="person-label">Persoon ${p.person_number}</div>
              <div class="person-details">
                <span><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong></span>
                ${p.birth_date ? `<span>Geboren: <strong>${fmtDate(p.birth_date)}</strong></span>` : ''}
                ${p.phone ? `<span>Tel: <strong>${esc(p.phone)}</strong></span>` : ''}
                ${p.mobile ? `<span>06: <strong>${esc(p.mobile)}</strong></span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

async function approveReg(id) {
  const btn = document.querySelector(`#qcard-${id} .btn-success`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  await fetch(`/api/admin/registrations/${id}/approve`, { method: 'PATCH' });
  document.getElementById(`qcard-${id}`)?.remove();
  const remaining = document.querySelectorAll('[id^="qcard-"]').length;
  updateQueueBadge(remaining);
  if (!remaining) {
    document.getElementById('queue-content').innerHTML = '<div class="empty-state">Geen aanmeldingen in de wachtrij.</div>';
  }
}

async function rejectReg(id) {
  if (!confirm('Aanmelding afwijzen? De datum wordt weer vrijgegeven.')) return;
  await fetch(`/api/admin/registrations/${id}/reject`, { method: 'PATCH' });
  document.getElementById(`qcard-${id}`)?.remove();
  const remaining = document.querySelectorAll('[id^="qcard-"]').length;
  updateQueueBadge(remaining);
  if (!remaining) {
    document.getElementById('queue-content').innerHTML = '<div class="empty-state">Geen aanmeldingen in de wachtrij.</div>';
  }
}

// ─── Clinics ─────────────────────────────────────────────────────────────────
async function loadClinics() {
  const el = document.getElementById('clinics-content');
  el.innerHTML = '<div style="color:var(--grey);padding:20px">Laden…</div>';
  try {
    const res = await fetch('/api/admin/clinics');
    const clinics = await res.json();
    renderClinics(clinics);
  } catch {
    el.innerHTML = '<div style="color:var(--red)">Fout bij laden van klinieken.</div>';
  }
}

function renderClinics(clinics) {
  const el = document.getElementById('clinics-content');
  if (!clinics.length) {
    el.innerHTML = '<div class="empty-state">Nog geen klinieken aangemaakt.</div>';
    return;
  }
  el.innerHTML = clinics.map(c => `
    <div class="clinic-admin-card">
      <div class="clinic-admin-header">
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="clinic-admin-meta">
            ${c.frequency ? esc(c.frequency) + ' &bull; ' : ''}
            ${c.time ? esc(c.time) + ' &bull; ' : ''}
            ${c.address ? esc(c.address) : '<em>Geen adres</em>'}
            ${c.contact_name ? ' &bull; ' + esc(c.contact_name) : ''}
            ${!c.allow_public_signup ? ' &bull; <em style="color:var(--orange)">Geen publieke aanmeldingen</em>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-secondary" style="font-size:.8rem;padding:6px 12px" onclick="openClinicModal(${c.id})">Bewerken</button>
          <button class="btn-icon danger" onclick="deleteClinic(${c.id}, '${esc(c.name).replace(/'/g,"\\'")}')">Verwijderen</button>
        </div>
      </div>
      <div class="clinic-admin-body">
        <div class="dates-admin-grid">
          ${c.dates.map(d => renderDateAdminCell(d)).join('') || '<span style="color:var(--grey);font-size:.875rem">Geen datums.</span>'}
        </div>
        <button class="btn-secondary" style="font-size:.8rem;padding:6px 12px" onclick="openDateModal(${c.id}, '${esc(c.name).replace(/'/g,"\\'")}')">+ Datum toevoegen</button>
      </div>
    </div>
  `).join('');
}

function renderDateAdminCell(d) {
  const label = fmtDate(d.date);
  const statusLabel = d.status === 'free' ? 'Vrij' : d.status === 'pending' ? 'In wachtrij' : 'Bezet';
  const statusClass = `status-${d.status}`;
  const names = d.names ? d.names.replace(/null/g, '').trim() : '';

  return `
    <div class="date-admin-cell ${d.status}">
      <div class="date-admin-top">
        <strong>${label}</strong>
        <span class="date-status-label ${statusClass}">${statusLabel}</span>
      </div>
      ${names ? `<div class="date-admin-names">${esc(names)}</div>` : ''}
      <div class="date-admin-actions">
        ${d.status === 'free' ? `<button class="btn-icon" onclick="openNewRegModal(${d.id})" title="Aanmelding toevoegen">Aanmelden</button>` : ''}
        ${d.reg_id ? `<button class="btn-icon" onclick="openEditRegModal(${d.reg_id})" title="Aanmelding bewerken">Bewerken</button>` : ''}
        ${d.status !== 'free' ? `<button class="btn-icon" onclick="clearDate(${d.id})" title="Vrijgeven">Vrijgeven</button>` : ''}
        <button class="btn-icon danger" onclick="deleteDate(${d.id})" title="Verwijderen">✕</button>
      </div>
    </div>`;
}

async function clearDate(dateId) {
  if (!confirm('Namen verwijderen en datum vrijgeven?')) return;
  await fetch(`/api/admin/dates/${dateId}/clear`, { method: 'PATCH' });
  loadClinics();
}

async function deleteDate(dateId) {
  if (!confirm('Datum permanent verwijderen?')) return;
  await fetch(`/api/admin/dates/${dateId}`, { method: 'DELETE' });
  loadClinics();
}

async function deleteClinic(id, name) {
  if (!confirm(`Kliniek "${name}" en alle bijbehorende datums verwijderen?`)) return;
  await fetch(`/api/admin/clinics/${id}`, { method: 'DELETE' });
  loadClinics();
}

// Clinic modal
let editingClinicId = null;

function openClinicModal(id) {
  editingClinicId = id || null;
  document.getElementById('clinic-modal-title').textContent = id ? 'Kliniek bewerken' : 'Nieuwe kliniek';
  document.getElementById('clinic-form-error').classList.add('hidden');

  if (id) {
    fetch('/api/admin/clinics').then(r => r.json()).then(clinics => {
      const c = clinics.find(x => x.id === id);
      if (!c) return;
      document.getElementById('c-name').value = c.name;
      document.getElementById('c-address').value = c.address || '';
      document.getElementById('c-freq').value = c.frequency || '';
      document.getElementById('c-time').value = c.time || '';
      document.getElementById('c-contact-name').value = c.contact_name || '';
      document.getElementById('c-contact-info').value = c.contact_info || '';
      document.getElementById('c-public-signup').checked = !!c.allow_public_signup;
    });
  } else {
    document.getElementById('clinic-form').reset();
    document.getElementById('c-public-signup').checked = true;
  }
  document.getElementById('clinic-modal-overlay').classList.remove('hidden');
}

function closeClinicModal() {
  document.getElementById('clinic-modal-overlay').classList.add('hidden');
  editingClinicId = null;
}

document.getElementById('clinic-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    name: document.getElementById('c-name').value.trim(),
    address: document.getElementById('c-address').value.trim(),
    frequency: document.getElementById('c-freq').value.trim(),
    time: document.getElementById('c-time').value.trim(),
    contact_name: document.getElementById('c-contact-name').value.trim(),
    contact_info: document.getElementById('c-contact-info').value.trim(),
    allow_public_signup: document.getElementById('c-public-signup').checked,
  };
  const errEl = document.getElementById('clinic-form-error');
  errEl.classList.add('hidden');

  const method = editingClinicId ? 'PUT' : 'POST';
  const url = editingClinicId ? `/api/admin/clinics/${editingClinicId}` : '/api/admin/clinics';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) {
    errEl.textContent = result.error;
    errEl.classList.remove('hidden');
    return;
  }
  closeClinicModal();
  loadClinics();
});

// Date modal
function openDateModal(clinicId, clinicName) {
  document.getElementById('date-clinic-id').value = clinicId;
  document.getElementById('date-modal-clinic').textContent = clinicName;
  document.getElementById('date-input').value = '';
  document.getElementById('date-form-error').classList.add('hidden');
  document.getElementById('date-modal-overlay').classList.remove('hidden');
}

function closeDateModal() {
  document.getElementById('date-modal-overlay').classList.add('hidden');
}

async function submitAddDate() {
  const clinic_id = document.getElementById('date-clinic-id').value;
  const date = document.getElementById('date-input').value;
  const errEl = document.getElementById('date-form-error');
  errEl.classList.add('hidden');

  if (!date) {
    errEl.textContent = 'Kies een datum.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await fetch('/api/admin/dates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinic_id: Number(clinic_id), date }),
  });
  const result = await res.json();
  if (!res.ok) {
    errEl.textContent = result.error;
    errEl.classList.remove('hidden');
    return;
  }
  closeDateModal();
  loadClinics();
}

// ─── Edit / New registration ──────────────────────────────────────────────────
function openNewRegModal(dateId) {
  // Zoek kliniek + datum info uit de DOM
  const cell = document.querySelector(`[onclick="openNewRegModal(${dateId})"]`)?.closest('.date-admin-cell');
  const card = cell?.closest('.clinic-admin-card');
  const clinicName = card?.querySelector('h3')?.textContent || '';
  const dateLabel = cell?.querySelector('strong')?.textContent || '';

  document.getElementById('edit-reg-id').value = '';
  document.getElementById('edit-reg-date-id').value = dateId;
  document.getElementById('edit-reg-info').textContent = `${clinicName} — ${dateLabel}`;
  document.getElementById('edit-reg-error').classList.add('hidden');

  // Leeg alle velden
  ['e-p1-fn','e-p1-ln','e-p1-bd','e-p1-phone','e-p1-mobile',
   'e-p2-fn','e-p2-ln','e-p2-bd','e-p2-phone',
   'e-p3-fn','e-p3-ln','e-p3-bd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('edit-reg-save').textContent = 'Aanmelden';
  document.getElementById('edit-reg-overlay').classList.remove('hidden');
}

async function openEditRegModal(regId) {
  const res = await fetch(`/api/admin/registrations/${regId}`);
  if (!res.ok) return alert('Aanmelding niet gevonden.');
  const reg = await res.json();

  document.getElementById('edit-reg-id').value = regId;
  document.getElementById('edit-reg-info').textContent =
    `${esc(reg.clinic_name)} — ${fmtDateFull(reg.date)}`;
  document.getElementById('edit-reg-error').classList.add('hidden');

  const g = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  const p1 = reg.persons.find(p => p.person_number === 1) || {};
  const p2 = reg.persons.find(p => p.person_number === 2) || {};
  const p3 = reg.persons.find(p => p.person_number === 3) || null;

  g('e-p1-fn', p1.first_name); g('e-p1-ln', p1.last_name);
  g('e-p1-bd', p1.birth_date); g('e-p1-phone', p1.phone || p1.mobile);
  g('e-p2-fn', p2.first_name); g('e-p2-ln', p2.last_name);
  g('e-p2-bd', p2.birth_date); g('e-p2-phone', p2.phone);
  g('e-p3-fn', p3?.first_name); g('e-p3-ln', p3?.last_name); g('e-p3-bd', p3?.birth_date);

  document.getElementById('edit-reg-date-id').value = '';
  document.getElementById('edit-reg-save').textContent = 'Opslaan';
  document.getElementById('edit-reg-overlay').classList.remove('hidden');
}

function closeEditRegModal() {
  document.getElementById('edit-reg-overlay').classList.add('hidden');
}

async function saveEditReg() {
  const regId  = document.getElementById('edit-reg-id').value;
  const dateId = document.getElementById('edit-reg-date-id').value;
  const isNew  = !regId && !!dateId;
  const errEl  = document.getElementById('edit-reg-error');
  errEl.classList.add('hidden');

  const g = id => document.getElementById(id)?.value.trim() || '';
  const persons = [
    { number: 1, first_name: g('e-p1-fn'), last_name: g('e-p1-ln'),
      birth_date: g('e-p1-bd'), phone: g('e-p1-phone'), mobile: '' },
    { number: 2, first_name: g('e-p2-fn'), last_name: g('e-p2-ln'),
      birth_date: g('e-p2-bd'), phone: g('e-p2-phone'), mobile: '' },
  ];
  const p3fn = g('e-p3-fn'), p3ln = g('e-p3-ln');
  if (p3fn || p3ln) {
    persons.push({ number: 3, first_name: p3fn, last_name: p3ln, birth_date: g('e-p3-bd') });
  }

  if (!persons[0].first_name || !persons[0].last_name) {
    errEl.textContent = 'Vul voornaam en achternaam in voor persoon 1.';
    errEl.classList.remove('hidden'); return;
  }
  if (!persons[1].first_name || !persons[1].last_name) {
    errEl.textContent = 'Vul voornaam en achternaam in voor persoon 2.';
    errEl.classList.remove('hidden'); return;
  }

  const btn = document.getElementById('edit-reg-save');
  btn.disabled = true; btn.textContent = isNew ? 'Aanmelden…' : 'Opslaan…';

  const url    = isNew ? `/api/admin/dates/${dateId}/register` : `/api/admin/registrations/${regId}`;
  const method = isNew ? 'POST' : 'PUT';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persons }),
  });
  btn.disabled = false; btn.textContent = isNew ? 'Aanmelden' : 'Opslaan';

  if (!res.ok) {
    const d = await res.json();
    errEl.textContent = d.error || 'Opslaan mislukt.';
    errEl.classList.remove('hidden'); return;
  }
  closeEditRegModal();
  // Ververs huidige view
  if (currentView === 'queue') loadQueue();
  else if (currentView === 'clinics') loadClinics();
  else if (currentView === 'week') loadWeek(currentWeekStart);
}

// ─── Week overview ───────────────────────────────────────────────────────────
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISO(d) { return d.toISOString().slice(0, 10); }

document.getElementById('week-prev').addEventListener('click', () => {
  if (!currentWeekStart) return;
  const d = new Date(currentWeekStart);
  d.setDate(d.getDate() - 7);
  loadWeek(toISO(d));
});
document.getElementById('week-next').addEventListener('click', () => {
  if (!currentWeekStart) return;
  const d = new Date(currentWeekStart);
  d.setDate(d.getDate() + 7);
  loadWeek(toISO(d));
});

async function loadWeek(startISO) {
  const el = document.getElementById('week-content');
  el.innerHTML = '<div style="color:var(--grey);padding:20px">Laden…</div>';

  const url = startISO ? `/api/admin/week?start=${startISO}` : '/api/admin/week';
  try {
    const res = await fetch(url);
    const data = await res.json();
    currentWeekStart = data.start;
    renderWeek(data);
  } catch {
    el.innerHTML = '<div style="color:var(--red)">Fout bij laden.</div>';
  }
}

function renderWeek(data) {
  const el = document.getElementById('week-content');
  const startD = new Date(data.start + 'T00:00:00');
  const endD = new Date(data.end + 'T00:00:00');

  document.getElementById('week-label').textContent =
    `${startD.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })} – ${endD.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  if (!data.dates.length) {
    el.innerHTML = '<div class="empty-state">Geen datums in deze week.</div>';
    return;
  }

  // Group by day
  const byDay = {};
  data.dates.forEach(d => {
    if (!byDay[d.date]) byDay[d.date] = [];
    byDay[d.date].push(d);
  });

  el.innerHTML = Object.entries(byDay).map(([date, entries]) => `
    <div class="week-day-group">
      <div class="week-day-title">${fmtDateFull(date)}</div>
      ${entries.map(entry => renderWeekEntry(entry)).join('')}
    </div>
  `).join('');
}

function renderWeekEntry(entry) {
  const hasReg = entry.persons && entry.persons.length > 0;
  const msg1 = hasReg ? buildMsg1(entry) : '';
  const msg2 = hasReg ? buildMsg2(entry) : '';

  return `
    <div class="week-entry">
      <div class="week-entry-header">
        <div>
          <div class="week-entry-clinic">${esc(entry.clinic_name)}</div>
          <div class="week-entry-meta">${esc(entry.time || '—')} &bull; ${esc(entry.address || 'Geen adres')}</div>
        </div>
        <span class="date-status-label ${entry.status === 'approved' ? 'status-approved' : 'status-free'}">
          ${entry.status === 'approved' ? 'Bezet' : 'Vrij'}
        </span>
      </div>
      <div class="week-entry-body">
        ${!hasReg ? '<div class="week-no-reg">Geen aanmelding voor deze datum.</div>' : `
          <div class="persons-list" style="margin-bottom:14px">
            ${entry.persons.map(p => {
              const tel = p.phone || p.mobile || '';
              return `
              <div class="person-row">
                <div class="person-label">Persoon ${p.person_number}</div>
                <div class="person-details">
                  <span><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong></span>
                  ${p.birth_date ? `<span>Geboren: <strong>${fmtDate(p.birth_date)}</strong></span>` : ''}
                  ${tel ? `<span>📞 <strong>${esc(tel)}</strong></span>` : ''}
                </div>
              </div>`; }).join('')}
          </div>
          <div class="msg-block">
            <div class="msg-label">
              Bericht 1 — Controle vrijwilliger(s)
              <button class="btn-copy" onclick="copyMsg(this)">Kopiëren</button>
            </div>
            <textarea class="msg-textarea" rows="3">${esc(msg1)}</textarea>
          </div>
          ${entry.contact_info || entry.contact_name ? `
          <div class="contact-info-block">
            <span class="contact-info-label">📞 Contact kliniek</span>
            ${entry.contact_name ? `<span class="contact-info-item"><strong>${esc(entry.contact_name)}</strong></span>` : ''}
            ${entry.contact_info ? `<span class="contact-info-item contact-info-copyable" title="Klik om te kopiëren" onclick="copyContactInfo(this)">${esc(entry.contact_info)}</span>` : ''}
          </div>` : ''}
          <label class="notified-check ${entry.clinic_notified ? 'is-notified' : ''}" onclick="toggleNotified(this, ${entry.id})">
            <input type="checkbox" ${entry.clinic_notified ? 'checked' : ''} style="display:none">
            <span class="notified-box">${entry.clinic_notified ? '✓' : ''}</span>
            <span class="notified-text">${entry.clinic_notified ? 'Aangemeld bij kliniek' : 'Nog niet aangemeld bij kliniek'}</span>
          </label>
          <div class="msg-block">
            <div class="msg-label">
              Bericht 2 — Aanmelding bij kliniek
              <button class="btn-copy" onclick="copyMsg(this)">Kopiëren</button>
            </div>
            <textarea class="msg-textarea" rows="4">${esc(msg2)}</textarea>
          </div>
        `}
      </div>
    </div>`;
}

function buildMsg1(entry) {
  const p1 = entry.persons.find(p => p.person_number === 1);
  if (!p1) return '';
  const naam = p1.first_name || 'vrijwilliger';
  const datum = fmtDateFull(entry.date);
  const kliniek = entry.clinic_name;
  const tijd = entry.time || '?';
  const adres = entry.address || '?';
  return `Hoi ${naam}, bedankt dat je een voorlichting wilt doen! Ik stuur je even een appje om te checken of je er nog steeds bij kunt zijn.\n\nDe datum is ${datum} om ${tijd} bij ${kliniek}, ${adres}.\n\nKun jij er nog bij zijn?`;
}

function buildMsg2(entry) {
  const datum = fmtDateFull(entry.date);
  const kliniek = entry.clinic_name;
  const contact = entry.contact_name || 'contactpersoon';
  const tijd = entry.time || '?';
  const vrijwilligers = entry.persons.map(p => {
    const naam = `${p.first_name} ${p.last_name}`.trim();
    const gbd = p.birth_date ? fmtDate(p.birth_date) : '—';
    return `${naam}, geb. ${gbd}`;
  }).join('\n- ');
  return `Beste ${contact},\n\nWij willen ons aanmelden voor ${datum} om ${tijd} bij ${kliniek}.\n\nDe vrijwilligers zijn:\n- ${vrijwilligers}\n\nMet vriendelijke groet,\nH&I`;
}

function copyMsg(btn) {
  const textarea = btn.closest('.msg-block').querySelector('.msg-textarea');
  navigator.clipboard.writeText(textarea.value).then(() => {
    btn.textContent = '✓ Gekopieerd';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Kopiëren'; btn.classList.remove('copied'); }, 2000);
  });
}

async function toggleNotified(label, dateId) {
  const checkbox = label.querySelector('input');
  const newVal = !checkbox.checked;
  checkbox.checked = newVal;
  label.classList.toggle('is-notified', newVal);
  label.querySelector('.notified-box').textContent = newVal ? '✓' : '';
  label.querySelector('.notified-text').textContent = newVal ? 'Aangemeld bij kliniek' : 'Nog niet aangemeld bij kliniek';
  await fetch(`/api/admin/dates/${dateId}/notified`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: newVal }),
  });
}

function copyContactInfo(el) {
  navigator.clipboard.writeText(el.textContent).then(() => {
    const orig = el.textContent;
    el.textContent = '✓ Gekopieerd!';
    setTimeout(() => { el.textContent = orig; }, 2000);
  });
}

// ─── Backups ─────────────────────────────────────────────────────────────────
async function loadBackups() {
  const el = document.getElementById('backups-content');
  el.innerHTML = '<div style="color:var(--grey);padding:20px">Laden…</div>';
  try {
    const res = await fetch('/api/admin/backups');
    const backups = await res.json();
    renderBackups(backups);
  } catch {
    el.innerHTML = '<div style="color:var(--red)">Fout bij laden van backups.</div>';
  }
}

function renderBackups(backups) {
  const el = document.getElementById('backups-content');
  if (!backups.length) {
    el.innerHTML = '<div class="empty-state">Nog geen backups. Maak er een aan via de knop hierboven.</div>';
    return;
  }
  el.innerHTML = `
    <table class="backup-table">
      <thead>
        <tr>
          <th>Datum &amp; tijd</th>
          <th>Bestandsnaam</th>
          <th>Grootte</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${backups.map(b => `
          <tr>
            <td>${fmtDateTime(b.created)}</td>
            <td style="font-family:monospace;font-size:.8rem;color:var(--grey)">${esc(b.filename)}</td>
            <td style="color:var(--grey)">${fmtSize(b.size)}</td>
            <td><a class="btn-secondary" style="font-size:.8rem;padding:5px 12px;text-decoration:none" href="/api/admin/backups/${esc(b.filename)}" download>Download</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="margin-top:12px;font-size:.8rem;color:var(--grey)">De laatste ${backups.length} backup${backups.length !== 1 ? 's' : ''} worden bewaard (max. 14).</p>
  `;
}

async function triggerBackup() {
  const btn = document.querySelector('#view-backups .btn-primary');
  btn.disabled = true; btn.textContent = 'Bezig…';
  try {
    const res = await fetch('/api/admin/backups', { method: 'POST' });
    if (res.ok) loadBackups();
    else {
      const d = await res.json();
      alert(d.error || 'Backup mislukt.');
    }
  } catch {
    alert('Verbindingsfout.');
  } finally {
    btn.disabled = false; btn.textContent = '+ Nu backup maken';
  }
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function fmtDateFull(iso) {
  if (!iso) return '';
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Start
init();
