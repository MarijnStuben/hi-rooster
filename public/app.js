const main = document.getElementById('main');
const overlay = document.getElementById('modal-overlay');
const form = document.getElementById('reg-form');
const formError = document.getElementById('form-error');
const toast = document.getElementById('success-toast');

// Dutch date formatter
function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  const months = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function fmtDateFull(iso) {
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Load and render roster
async function loadClinics() {
  try {
    const res = await fetch('/api/clinics');
    const clinics = await res.json();
    renderClinics(clinics);
  } catch {
    main.innerHTML = '<div class="loading">Rooster kon niet worden geladen. Probeer de pagina te herladen.</div>';
  }
}

function renderClinics(clinics) {
  if (!clinics.length) {
    main.innerHTML = '<div class="loading">Geen klinieken gevonden.</div>';
    return;
  }

  main.innerHTML = clinics.map(clinic => {
    const datesHtml = clinic.dates.length
      ? clinic.dates.map(d => renderDateCell(d, clinic)).join('')
      : '<p style="color:var(--grey);font-size:.875rem">Geen datums ingepland.</p>';

    const metaParts = [];
    if (clinic.frequency) metaParts.push(`<span>📅 ${escHtml(clinic.frequency)}</span>`);
    if (clinic.time) metaParts.push(`<span>🕐 ${escHtml(clinic.time)}</span>`);
    if (clinic.address) metaParts.push(`<span>📍 ${escHtml(clinic.address)}</span>`);
    if (clinic.contact_name) metaParts.push(`<span>👤 ${escHtml(clinic.contact_name)}</span>`);

    return `
      <div class="clinic-card">
        <div class="clinic-header">
          <h2>${escHtml(clinic.name)}</h2>
          <div class="clinic-meta">${metaParts.join('')}</div>
        </div>
        <div class="clinic-body">
          <div class="dates-grid">${datesHtml}</div>
        </div>
      </div>`;
  }).join('');
}

function renderDateCell(d, clinic) {
  const label = fmtDate(d.date);
  if (d.status === 'free') {
    if (clinic.allow_public_signup === 0 || clinic.allow_public_signup === false) {
      // Kliniek zonder publieke aanmelding: datum tonen, geen knop
      return `
        <div class="date-cell free no-signup" data-date-id="${d.id}">
          <span class="date-label">${label}</span>
          <span class="via-admin-label">Via admin</span>
        </div>`;
    }
    return `
      <div class="date-cell free" data-date-id="${d.id}">
        <span class="date-label">${label}</span>
        <button class="btn-aanmelden" onclick="openForm(${d.id}, '${escAttr(clinic.name)}', '${d.date}', '${escAttr(clinic.time || '')}')">
          Aanmelden
        </button>
      </div>`;
  }
  // Bezet: toon voornamen als beschikbaar
  const names = d.first_names ? escHtml(d.first_names) : null;
  return `
    <div class="date-cell occupied">
      <span class="date-label">${label}</span>
      <span class="bezet-label">Bezet</span>
      ${names ? `<span class="bezet-names">${names}</span>` : ''}
    </div>`;
}

// Modal
function openForm(dateId, clinicName, dateIso, time) {
  document.getElementById('form-date-id').value = dateId;
  document.getElementById('form-clinic-name').textContent = clinicName;
  document.getElementById('form-date-display').textContent = fmtDateFull(dateIso);
  document.getElementById('form-time-display').textContent = time || '—';
  form.reset();
  formError.classList.add('hidden');
  document.getElementById('p3-fieldset').classList.add('hidden');
  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;
  form.querySelector('[name="p1_first_name"]').focus();
}

function closeModal() {
  overlay.classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('form-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Person 3 toggle
document.getElementById('add-p3-btn').addEventListener('click', () => {
  document.getElementById('p3-fieldset').classList.remove('hidden');
  document.getElementById('p3-toggle-row').classList.add('hidden');
});
document.getElementById('remove-p3-btn').addEventListener('click', () => {
  document.getElementById('p3-fieldset').classList.add('hidden');
  document.getElementById('p3-toggle-row').classList.remove('hidden');
  ['p3_first_name','p3_last_name','p3_birth_date'].forEach(n => {
    form.querySelector(`[name="${n}"]`).value = '';
  });
});

// Form submit
form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.classList.add('hidden');

  const dateId = parseInt(document.getElementById('form-date-id').value);
  const g = name => form.querySelector(`[name="${name}"]`).value.trim();

  const persons = [
    { number: 1, first_name: g('p1_first_name'), last_name: g('p1_last_name'),
      birth_date: g('p1_birth_date'), phone: g('p1_phone'), mobile: '' },
    { number: 2, first_name: g('p2_first_name'), last_name: g('p2_last_name'),
      birth_date: g('p2_birth_date'), phone: g('p2_phone'), mobile: '' },
  ];

  const p3Visible = !document.getElementById('p3-fieldset').classList.contains('hidden');
  if (p3Visible) {
    const p3fn = g('p3_first_name'), p3ln = g('p3_last_name');
    if (p3fn || p3ln) {
      persons.push({ number: 3, first_name: p3fn, last_name: p3ln, birth_date: g('p3_birth_date') });
    }
  }

  const submitBtn = document.getElementById('form-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Bezig…';

  try {
    const res = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_id: dateId, persons }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Er is een fout opgetreden.');
      return;
    }

    closeModal();
    // Mark date as occupied in the DOM
    const cell = document.querySelector(`.date-cell[data-date-id="${dateId}"]`);
    if (cell) {
      cell.className = 'date-cell occupied';
      cell.innerHTML = `<span class="date-label">${cell.querySelector('.date-label').textContent}</span><span class="bezet-label">Bezet</span>`;
    }
    showToast();
  } catch {
    showError('Netwerkfout. Probeer opnieuw.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Aanmelden';
  }
});

function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

function showToast() {
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

loadClinics();
