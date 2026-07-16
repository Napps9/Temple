// Column auto-detection for the import wizard. Members come from
// Mindbody / PushPress / Glofox / Wodify / ClubReady / spreadsheets;
// each labels the same field differently. This module knows the
// common header strings and maps them to our `TempleField` set so
// the column-mapper screen is mostly pre-filled — owners only have
// to touch the rare misses.

export type TempleField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'date_of_birth'
  | 'phone'
  | 'emergency_contact'
  | 'plan_name'
  | 'plan_start'
  | 'plan_end'
  | 'next_bill_date'
  | 'credits_remaining'
  | 'imported_status'
  | 'tags'
  | 'unsubscribed'
  | 'notes';

export const TEMPLE_FIELD_LABELS: Record<TempleField, string> = {
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name (single column)',
  date_of_birth: 'Date of birth',
  phone: 'Mobile / phone number',
  emergency_contact: 'Emergency contact',
  plan_name: 'Plan / Membership',
  plan_start: 'Plan start date',
  plan_end: 'Plan end date',
  next_bill_date: 'Next bill date',
  credits_remaining: 'Credits / sessions remaining',
  imported_status: 'Source status',
  tags: 'Tags',
  unsubscribed: 'Unsubscribed / no marketing',
  notes: 'Notes',
};

// Header strings each source CRM exports for a given Temple field.
// Match is case-insensitive, whitespace + punctuation normalised.
const FIELD_HEADERS: Record<TempleField, string[]> = {
  email: [
    'email', 'email address', 'emailaddress', 'client email',
    'member email', 'contact email', 'e-mail',
  ],
  first_name: [
    'first name', 'firstname', 'first', 'given name', 'givenname',
  ],
  last_name: [
    'last name', 'lastname', 'last', 'surname', 'family name',
  ],
  full_name: [
    'name', 'full name', 'fullname', 'member name', 'client name',
    'contact name', 'membername', 'clientname',
  ],
  date_of_birth: [
    'dob', 'date of birth', 'birthday', 'birth date', 'birthdate',
  ],
  phone: [
    'phone', 'mobile', 'mobile number', 'mobile phone', 'cell',
    'cell phone', 'phone number', 'telephone', 'contact number',
  ],
  emergency_contact: [
    'emergency contact', 'emergency contact name', 'emergency contact number',
    'emergency', 'next of kin', 'in case of emergency', 'ice contact',
  ],
  next_bill_date: [
    'next bill date', 'next billing date', 'next payment', 'next payment date',
    'next charge', 'next charge date', 'nextbilldate',
  ],
  plan_name: [
    'plan', 'membership', 'membership plan', 'membership type',
    'pass', 'package', 'pricing option', 'pricing', 'product',
    'subscription', 'plan name',
  ],
  plan_start: [
    'start', 'start date', 'startdate', 'membership start',
    'active since', 'joined', 'join date', 'signup date',
    'signupdate', 'plan start',
  ],
  plan_end: [
    'end', 'end date', 'enddate', 'expiry', 'expires',
    'expiration', 'expiration date', 'membership end',
    'next renewal', 'renewal date', 'plan end',
  ],
  credits_remaining: [
    'credits', 'credits remaining', 'sessions remaining',
    'sessions left', 'visits remaining', 'visits left',
    'classes remaining', 'remaining',
  ],
  imported_status: [
    'status', 'membership status', 'state', 'active',
    'subscription status',
  ],
  tags: [
    'tags', 'labels', 'groups', 'categories', 'segments',
  ],
  unsubscribed: [
    'unsubscribed', 'opted out', 'opted_out', 'no marketing',
    'no_marketing', 'marketing opt-out', 'marketing opt out',
    'do not contact', 'donotcontact',
  ],
  notes: [
    'notes', 'note', 'comments', 'description',
  ],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, ' ').trim();
}

// For each CSV header, pick the Temple field whose alias set contains
// an exact normalised match. Headers we can't map come back as null —
// the UI will show them as "ignore" so the owner can wire them up.
export function autoDetect(headers: string[]): (TempleField | null)[] {
  const used = new Set<TempleField>();
  return headers.map((h) => {
    const n = normalise(h);
    for (const field of Object.keys(FIELD_HEADERS) as TempleField[]) {
      if (used.has(field)) continue;
      if (FIELD_HEADERS[field].some((alias) => normalise(alias) === n)) {
        used.add(field);
        return field;
      }
    }
    return null;
  });
}

// Privacy-safe per-column profile for AI-assisted mapping. We never send
// raw cell values to the model — only the header plus the shape of the
// column (value kind, how full it is, how repetitive). That's enough
// signal to disambiguate headers the alias heuristic misses, with no
// member PII leaving the client.
export type ColumnKind =
  | 'email'
  | 'date'
  | 'number'
  | 'phone'
  | 'boolean'
  | 'text'
  | 'empty';

export type ColumnHint = {
  header: string;
  kind: ColumnKind;
  fill_rate: number; // share of sampled rows with a value, 0-1
  distinct_ratio: number; // distinct values / values present, 0-1
};

function classifyValue(v: string): ColumnKind {
  if (!v) return 'empty';
  if (/@/.test(v) && /\.[a-z]{2,}$/i.test(v)) return 'email';
  if (toIsoDate(v)) return 'date';
  if (/^(y|yes|n|no|true|false)$/i.test(v)) return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^[+(]?\d[\d ()\-.]{7,}$/.test(v)) return 'phone';
  return 'text';
}

function dominantKind(values: string[]): ColumnKind {
  if (values.length === 0) return 'empty';
  const counts = new Map<ColumnKind, number>();
  for (const v of values) {
    const k = classifyValue(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: ColumnKind = 'text';
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

// Per-column profile from a sample of rows. Sampling caps the work on
// large imports; the shape stabilises well within 50 rows.
export function columnHints(headers: string[], rows: string[][]): ColumnHint[] {
  const sample = rows.slice(0, 50);
  const denom = Math.max(1, sample.length);
  return headers.map((header, i) => {
    const values = sample.map((r) => (r[i] ?? '').trim()).filter(Boolean);
    const distinct = new Set(values.map((v) => v.toLowerCase())).size;
    return {
      header,
      kind: dominantKind(values),
      fill_rate: Math.round((values.length / denom) * 100) / 100,
      distinct_ratio:
        values.length === 0
          ? 0
          : Math.round((distinct / values.length) * 100) / 100,
    };
  });
}

// Coerce the source row into the import RPC's row shape. Empty cells
// drop out; cell values are trimmed; booleans accept y/yes/true/1;
// tags split on comma OR semicolon; dates pass through as-is (the RPC
// casts to date inside Postgres and rejects malformed values).
//
// `planMap`: when present, stamp `linked_membership_plan_id` on the
// row when the CSV's plan_name matches a key in the map. Used by the
// Review step of the wizard to bootstrap plan_subscriptions on signup.
//
// `tagsDrop`: case-insensitive set of tag values the owner has chosen
// to drop in the review step; those tags are removed from the row's
// staged `tags` array.
// "Smith, John" → "John Smith". Mindbody and several older CRMs export the
// member name surname-first; store it natural-order so it displays right and
// matches the dedup normaliser. Only a single comma triggers the swap — a
// value with more (or an empty side) is left untouched.
function reorderSurnameFirst(name: string): string {
  const parts = name.split(',');
  if (parts.length !== 2) return name;
  const last = parts[0].trim();
  const first = parts[1].trim();
  if (!last || !first) return name;
  return `${first} ${last}`;
}

export function buildImportRow(
  headers: string[],
  mapping: (TempleField | null)[],
  cells: string[],
  opts: {
    planMap?: Map<string, string>;
    tagsDrop?: Set<string>;
  } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let first: string | null = null;
  let last: string | null = null;

  for (let i = 0; i < headers.length; i += 1) {
    const field = mapping[i];
    if (!field) continue;
    const value = (cells[i] ?? '').trim();
    if (!value) continue;

    switch (field) {
      case 'email':
        out.email = value.toLowerCase();
        break;
      case 'first_name':
        first = value;
        break;
      case 'last_name':
        last = value;
        break;
      case 'full_name':
        out.full_name = reorderSurnameFirst(value);
        break;
      case 'tags':
        out.tags = value
          .split(/[,;]+/)
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case 'unsubscribed':
        out.unsubscribed = /^(y|yes|true|1|opt|unsub)/i.test(value);
        break;
      case 'credits_remaining': {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n) && n >= 0) out.credits_remaining = n;
        break;
      }
      case 'date_of_birth':
      case 'plan_start':
      case 'plan_end':
      case 'next_bill_date': {
        const iso = toIsoDate(value);
        if (iso) out[field] = iso;
        break;
      }
      case 'emergency_contact':
        // Source CRMs often split this into separate name/number
        // columns; Temple has one free-text field, so concatenate
        // rather than let the second mapped column overwrite the first.
        out.emergency_contact = out.emergency_contact
          ? `${out.emergency_contact} — ${value}`
          : value;
        break;
      default:
        out[field] = value;
    }
  }
  if (!out.full_name && (first || last)) {
    out.full_name = [first, last].filter(Boolean).join(' ');
  }
  if (opts.tagsDrop && Array.isArray(out.tags)) {
    const dropLower = new Set(
      Array.from(opts.tagsDrop, (t) => t.toLowerCase()),
    );
    out.tags = (out.tags as string[]).filter(
      (t) => !dropLower.has(t.toLowerCase()),
    );
  }
  if (opts.planMap && typeof out.plan_name === 'string') {
    const mapped = opts.planMap.get(out.plan_name as string);
    if (mapped) out.linked_membership_plan_id = mapped;
  }
  return out;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4,
  april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

// Named-month forms: "15 Jan 2024", "15 January 2024", "Jan 15, 2024",
// "January 15 2024", "15-Jan-2024". Positional: whichever side of the
// month token holds the day. Two-digit years map to 20xx.
function fromNamedMonth(v: string): string | null {
  const parts = v
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length !== 3) return null;
  const mi = parts.findIndex((p) => MONTH_NAMES[p] !== undefined);
  let dayStr: string;
  let yearStr: string;
  if (mi === 0) {
    dayStr = parts[1];
    yearStr = parts[2];
  } else if (mi === 1) {
    dayStr = parts[0];
    yearStr = parts[2];
  } else {
    return null;
  }
  const mo = MONTH_NAMES[parts[mi]];
  const d = Number(dayStr);
  let y = Number(yearStr);
  if (!Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Accepts ISO (YYYY-MM-DD, also '/'- or '.'-separated), YYYY-DD-MM (legacy
// CSV exports that flipped month and day), M/D/Y and D/M/Y slash formats
// (auto-flipped the same way when the month slot is unambiguously out of
// range), the dotted European form, spelled-out months ("15 Jan 2024"),
// and bare Excel serial day-numbers. When both slots could be either day
// or month, M/D/Y is the tie-break — that ambiguity is unresolvable from
// the string alone. Anything that doesn't look like a date returns null —
// the import row is skipped on that field rather than blowing up the
// whole batch in Postgres.
export function toIsoDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  // YYYY-MM-DD (or YYYY-DD-MM), also with '/' or '.' separators. If the
  // "month" slot is > 12 and the "day" slot ≤ 12, the parts are flipped —
  // common when a CSV was built with a UK locale that writes the day first.
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = +m[1];
    let mo = +m[2];
    let d = +m[3];
    if (mo > 12 && d <= 12) {
      const tmp = mo;
      mo = d;
      d = tmp;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    // US convention M/D/Y, but flip like the ISO branch above when the
    // "month" slot is > 12 and the "day" slot isn't — most CSV exports
    // from UK/EU gyms write DD/MM/YYYY, so 15/11/2026 (a real value
    // from a WodBoard export) would otherwise be silently dropped as
    // "month 15".
    let mo = +m[1], d = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) {
      const tmp = mo;
      mo = d;
      d = tmp;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = v.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})$/);
  if (m) {
    // European convention D.M.Y / D-M-Y.
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const named = fromNamedMonth(v);
  if (named) return named;
  // Bare Excel serial date (days since 1899-12-30). Only a 5-digit number in
  // a sane modern window is treated this way, so a stray id/count in a date
  // column doesn't get read as a date. 20000≈1954, 60000≈2064.
  if (/^\d{5}$/.test(v)) {
    const serial = Number(v);
    if (serial >= 20000 && serial <= 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return null;
}
