const WEEKDAYS = { zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6 };
const WEEKDAY_NAMES = Object.fromEntries(Object.entries(WEEKDAYS).map(([name, n]) => [n, name]));
const ORDINALS = { eerste: 1, tweede: 2, derde: 3, vierde: 4, laatste: -1, 1: 1, 2: 2, 3: 3, 4: 4 };
const ORDINAL_NAMES = { 1: 'eerste', 2: 'tweede', 3: 'derde', 4: 'vierde', '-1': 'laatste' };
const WEEKDAY_PATTERN = Object.keys(WEEKDAYS).join('|');
const NTH_RE = new RegExp(`\\b(eerste|tweede|derde|vierde|laatste|[1-4])(?:e|de|ste)?\\s+(${WEEKDAY_PATTERN})`);
const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`);

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISO(iso) {
  return new Date(iso + 'T00:00:00');
}

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function isLastOfMonth(d) {
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() + 7 > dim;
}

function matchesNth(iso, rule) {
  const d = parseISO(iso);
  if (d.getDay() !== rule.weekday) return false;
  if (rule.ordinal === -1) return isLastOfMonth(d);
  return Math.ceil(d.getDate() / 7) === rule.ordinal;
}

function nthWeekdayOfMonth(y, m, weekday, ordinal) {
  if (ordinal === -1) {
    const last = new Date(y, m + 1, 0);
    return new Date(y, m, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(y, m, 1);
  return new Date(y, m, 1 + ((weekday - first.getDay() + 7) % 7) + 7 * (ordinal - 1));
}

function parseFrequency(text) {
  const t = String(text || '').toLowerCase();
  const nth = t.match(NTH_RE);
  if (nth) return { kind: 'nth', ordinal: ORDINALS[nth[1]], weekday: WEEKDAYS[nth[2]], everyMonths: 1, source: 'omschrijving' };
  const wd = t.match(WEEKDAY_RE);
  const months = t.match(/(\d+)\s*maanden/);
  if (months && wd) {
    return { kind: 'nth', ordinal: null, weekday: WEEKDAYS[wd[1]], everyMonths: Number(months[1]), source: 'omschrijving' };
  }
  const weeks = t.match(/(\d+)\s*weken/);
  if (weeks) {
    const wd = t.match(WEEKDAY_RE);
    return { kind: 'interval', days: Number(weeks[1]) * 7, weekday: wd ? WEEKDAYS[wd[1]] : null, source: 'omschrijving' };
  }
  return null;
}

function inferFromHistory(dates) {
  const recent = dates.slice(-5);
  if (recent.length < 2) return null;
  const weekday = parseISO(recent[recent.length - 1]).getDay();
  const sameWeekday = recent.every(d => parseISO(d).getDay() === weekday);
  const ordinals = recent.map(d => {
    const day = parseISO(d);
    return isLastOfMonth(day) ? -1 : Math.ceil(day.getDate() / 7);
  });
  if (sameWeekday && ordinals.every(o => o === ordinals[0])) {
    return { kind: 'nth', ordinal: ordinals[0], weekday, source: 'historie' };
  }
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
  if (gaps.every(g => g === gaps[0])) {
    return { kind: 'interval', days: gaps[0], weekday, source: 'historie' };
  }
  return null;
}

function checkAgainst(rule, dates) {
  const recent = dates.slice(-3);
  const warnings = [];
  if (rule.kind === 'interval') {
    const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
    if (gaps.some(g => g !== rule.days)) {
      warnings.push(`De laatste datums liggen ${gaps.join(', ')} dagen uit elkaar, de omschrijving zegt ${rule.days}.`);
    }
    if (rule.weekday !== null && parseISO(recent[recent.length - 1]).getDay() !== rule.weekday) {
      warnings.push(`De laatste datum valt niet op ${WEEKDAY_NAMES[rule.weekday]}, zoals de omschrijving zegt.`);
    }
  } else {
    const bad = recent.filter(d => !matchesNth(d, rule));
    if (bad.length) {
      warnings.push(`Deze recente datums passen niet bij "${describe(rule)}": ${bad.join(', ')}.`);
    }
  }
  return warnings;
}

function describe(rule) {
  if (rule.kind === 'nth') {
    const every = rule.everyMonths > 1 ? `elke ${rule.everyMonths} maanden` : 'elke maand';
    return `${every}, ${ORDINAL_NAMES[rule.ordinal]} ${WEEKDAY_NAMES[rule.weekday]}`;
  }
  if (rule.days % 7 === 0) {
    const weeks = rule.days / 7;
    const on = rule.weekday !== null && rule.weekday !== undefined ? ` op ${WEEKDAY_NAMES[rule.weekday]}` : '';
    return `elke ${weeks} ${weeks === 1 ? 'week' : 'weken'}${on}`;
  }
  return `elke ${rule.days} dagen`;
}

function resolveSchedule(frequency, dates) {
  const fromText = parseFrequency(frequency);
  if (fromText) {
    let rule = fromText;
    if (rule.ordinal === null) {
      const keys = dates
        .filter(d => parseISO(d).getDay() === rule.weekday)
        .slice(-3)
        .map(d => (isLastOfMonth(parseISO(d)) ? -1 : Math.ceil(parseISO(d).getDate() / 7)));
      if (!keys.length || keys.some(k => k !== keys[0])) return null;
      rule = { ...rule, ordinal: keys[0] };
    }
    return { rule, warnings: checkAgainst(rule, dates) };
  }
  const fromHistory = inferFromHistory(dates);
  if (fromHistory) return { rule: fromHistory, warnings: [] };
  return null;
}

function anchorFor(rule, dates) {
  if (rule.kind === 'interval') return dates[dates.length - 1];
  return [...dates].reverse().find(d => matchesNth(d, rule));
}

function generateDates(rule, dates, untilISO) {
  const anchor = anchorFor(rule, dates);
  if (!anchor) return [];
  const out = [];
  if (rule.kind === 'interval') {
    const d = parseISO(anchor);
    for (;;) {
      d.setDate(d.getDate() + rule.days);
      const iso = toLocalISO(d);
      if (iso > untilISO) break;
      out.push(iso);
    }
    return out;
  }
  const step = rule.everyMonths || 1;
  const a = parseISO(anchor);
  let y = a.getFullYear();
  let m = a.getMonth();
  for (;;) {
    m += step;
    y += Math.floor(m / 12);
    m %= 12;
    const iso = toLocalISO(nthWeekdayOfMonth(y, m, rule.weekday, rule.ordinal));
    if (iso > untilISO) break;
    out.push(iso);
  }
  return out;
}

module.exports = { toLocalISO, resolveSchedule, generateDates, describe, parseFrequency, inferFromHistory, checkAgainst };
