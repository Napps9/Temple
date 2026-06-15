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
  | 'plan_name'
  | 'plan_start'
  | 'plan_end'
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
  plan_name: 'Plan / Membership',
  plan_start: 'Plan start date',
  plan_end: 'Plan end date',
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

// Coerce the source row into the import RPC's row shape. Empty cells
// drop out; cell values are trimmed; booleans accept y/yes/true/1;
// tags split on comma OR semicolon; dates pass through as-is (the RPC
// casts to date inside Postgres and rejects malformed values).
export function buildImportRow(
  headers: string[],
  mapping: (TempleField | null)[],
  cells: string[],
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
        out.full_name = value;
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
      case 'plan_end': {
        const iso = toIsoDate(value);
        if (iso) out[field] = iso;
        break;
      }
      default:
        out[field] = value;
    }
  }
  if (!out.full_name && (first || last)) {
    out.full_name = [first, last].filter(Boolean).join(' ');
  }
  return out;
}

// Accepts ISO (YYYY-MM-DD), YYYY-DD-MM (legacy CSV exports that flipped
// month and day), the two common US slash formats, and the dotted
// European form. Anything that doesn't look like a date returns null —
// the import row is skipped on that field rather than blowing up the
// whole batch in Postgres.
export function toIsoDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  // YYYY-MM-DD (or YYYY-DD-MM). If the "month" slot is > 12 and the
  // "day" slot ≤ 12, the parts are flipped — common when a CSV was
  // built with a UK locale that writes the day first.
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
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
    // US convention M/D/Y. Two-digit year → 2000s.
    const mo = +m[1], d = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
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
  return null;
}
