// Reads for the talk bar.
//
// Until now the bar only wrote: every sentence became a change to
// confirm. Asking about a member, or about a class that already exists,
// needs the opposite shape — resolve what the owner named, show it, and
// only then offer the change. The resolving happens here so it can be
// tested away from the feed, and the fetching happens in the owner's own
// session under RLS, so the bar reaches exactly as far as the screens do
// and no further.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sanitiseMemberQuery(raw: unknown): string | null {
  const r = raw as { query?: unknown } | null;
  const q = typeof r?.query === 'string' ? r.query : raw;
  if (typeof q !== 'string') return null;
  const clean = q.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 60) return null;
  return clean;
}

// Ranked rather than filtered: "marc" should reach Marcus before it
// reaches Jo Marchant, and a name typed in full should land on that one
// person instead of opening a pick list next to their near-namesakes.
export function matchMembers<T extends { name: string }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.toLowerCase();
  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    const name = row.name.toLowerCase();
    const parts = name.split(' ').filter(Boolean);
    let score: number;
    if (name === q) score = 0;
    else if (parts.some((p) => p === q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (parts.some((p) => p.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 4;
    else continue;
    scored.push({ row, score });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name));
  const best = scored[0].score;
  const top = scored.filter((s) => s.score === best);
  // An exact hit on the whole name or on one of its parts is an answer,
  // not a candidate — don't make someone disambiguate their own Marcus
  // against everyone whose surname happens to contain it.
  if (best <= 1 && top.length === 1) return [top[0].row];
  return scored.slice(0, 8).map((s) => s.row);
}

export type MemberFacts = {
  isIntro: boolean;
  isActive: boolean;
  isExpiringSoon: boolean;
  isExpired: boolean;
  daysUntilExpiry: number | null;
};

export type MemberStatus = {
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
};

export function memberStatus(m: MemberFacts): MemberStatus {
  if (m.isExpired) return { label: 'Lapsed', tone: 'bad' };
  if (m.isExpiringSoon) {
    const d = m.daysUntilExpiry;
    if (d !== null && d <= 0) return { label: 'Expires today', tone: 'warn' };
    return {
      label: d === null ? 'Expiring soon' : `Expiring in ${d} day${d === 1 ? '' : 's'}`,
      tone: 'warn',
    };
  }
  if (m.isActive && m.isIntro) return { label: 'On an intro', tone: 'good' };
  if (m.isActive) return { label: 'Active', tone: 'good' };
  return { label: 'No membership', tone: 'neutral' };
}

export type ClassEditRequest = {
  classType: string | null;
  days: number[] | null;
  from: string | null;
  to: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  shiftMinutes: number | null;
};

// Model output is untrusted, and this one moves real classes members are
// booked onto, so every field is re-checked against the same bounds the
// bulk-edit modal enforces. A request that names no actual change is
// dropped rather than shown as an empty "confirm this".
export function sanitiseClassEdit(raw: unknown): ClassEditRequest | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;

  const classType =
    typeof r.class_type === 'string' && r.class_type.trim()
      ? r.class_type.trim().replace(/\s+/g, ' ').slice(0, 60)
      : null;

  let days: number[] | null = null;
  if (Array.isArray(r.days)) {
    const set = new Set<number>();
    for (const d of r.days) {
      if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) {
        set.add(d);
      }
    }
    if (set.size > 0) days = [...set].sort((a, b) => a - b);
  }

  const from = typeof r.from === 'string' && ISO_DATE_RE.test(r.from) ? r.from : null;
  const to = typeof r.to === 'string' && ISO_DATE_RE.test(r.to) ? r.to : null;
  if (from && to && to < from) return null;

  const capacity = boundedInt(r.capacity, 1, 200);
  const durationMinutes = boundedInt(r.duration_minutes, 5, 480);
  const shiftMinutes = boundedInt(r.shift_minutes, -720, 720);

  if (capacity === null && durationMinutes === null && !shiftMinutes) return null;

  return {
    classType,
    days,
    from,
    to,
    capacity,
    durationMinutes,
    shiftMinutes: shiftMinutes === 0 ? null : shiftMinutes,
  };
}

function boundedInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

// "Cap Saturdays at 20" names no end date, and an unbounded edit is not
// something to run off one sentence — so an open-ended request is capped
// at twelve weeks and the card says so before anyone confirms.
export const DEFAULT_EDIT_WEEKS = 12;

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function classEditWindow(
  req: ClassEditRequest,
  todayIso: string,
): { start: string; end: string; bounded: boolean } {
  const start = req.from && req.from > todayIso ? req.from : todayIso;
  if (req.to) return { start, end: req.to, bounded: false };
  return { start, end: addDays(start, DEFAULT_EDIT_WEEKS * 7), bounded: true };
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// "Saturday", "Tuesdays and Thursdays", "weekdays" — what the owner would
// have said, read back so the window they're about to change is obvious.
export function describeEditTarget(req: ClassEditRequest, count: number): string {
  const noun = count === 1 ? '1 class' : `${count} classes`;
  const bits: string[] = [];
  if (req.days) {
    const weekday = [1, 2, 3, 4, 5];
    const isWeekdays =
      req.days.length === 5 && weekday.every((d) => req.days!.includes(d));
    if (isWeekdays) bits.push('weekday');
    else if (req.days.length === 1) bits.push(DAY_NAMES[req.days[0]]);
    else bits.push(req.days.map((d) => DAY_NAMES[d].slice(0, 3)).join('/'));
  }
  if (req.classType) bits.push(req.classType);
  return bits.length > 0 ? `${noun} — ${bits.join(' ')}` : noun;
}
