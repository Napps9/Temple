// Day-one conversational setup: the fixed script's data shapes, the
// sanitisers that stand between model output and anything the client
// renders or applies, and the best-practice rules bundle. The
// conversation itself is deterministic (welcome → timetable → prices →
// rules → go live) — the model only ever parses the owner's free-text
// description into one of these proposals, and nothing is written until
// the owner confirms a preview built from the sanitised form.

export type ProposedSchedule = {
  class_type: string;
  // 0=Sun … 6=Sat, matching class_recurrences.days_of_week (0005).
  days: number[];
  times: string[];
  duration_minutes: number;
  capacity: number;
};

export type TimetableProposal = {
  class_types: { name: string; color: string }[];
  schedules: ProposedSchedule[];
};

export type PlanKind =
  | 'unlimited'
  | 'credit_period'
  | 'credit_pack'
  | 'programming_only';

export type ProposedPlan = {
  name: string;
  kind: PlanKind;
  monthly_price_cents: number | null;
  credit_count: number | null;
  blurb: string;
};

export type PlansProposal = { plans: ProposedPlan[] };

// Distinct, colour-blind-friendly enough for calendar blocks; assigned
// round-robin because the owner never asked for a colour picker on day
// one. These are class-type data colours, not the brand token.
export const CLASS_TYPE_PALETTE = [
  '#3B82F6',
  '#8B5CF6',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#14B8A6',
];

// "How gyms like yours usually run bookings." Booking window and cutoff
// live on the gym; the 9pm-night-before cancel policy lives on each
// class type, because the gym-level day_before mode is retired — the
// booking trigger only honours the class-type override now.
export const BEST_PRACTICE_RULES = {
  booking_window_hours_ahead: 168,
  booking_cutoff_minutes_before: 0,
  class_cancel: {
    cancel_cutoff_mode: 'day_before' as const,
    cancel_cutoff_time: '21:00',
    cancel_cutoff_days_before: 1,
    cancel_cutoff_minutes_before: 0,
  },
};

export const RULE_SENTENCES = [
  'Book up to 7 days ahead',
  'Free cancel until 9pm the night before',
  'Late cancel uses the class credit',
  'Waitlist fills empty spots automatically',
  'Waiver signed before the first class',
];

const MAX_CLASS_TYPES = 6;
const MAX_SCHEDULES = 20;
const MAX_TIMES_PER_SCHEDULE = 12;
const MAX_PLANS = 8;
const NAME_MAX = 40;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  return s.length >= 2 ? s : null;
}

function cleanTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 4 || h > 22 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function clampInt(
  raw: unknown,
  lo: number,
  hi: number,
  fallback: number | null,
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const n = Math.round(raw);
  if (n < lo || n > hi) return fallback;
  return n;
}

// Model output is untrusted input: everything is re-derived here, and a
// proposal that survives with no valid schedules is rejected outright so
// the UI never shows an empty "confirm this" card.
export function sanitiseTimetable(raw: unknown): TimetableProposal | null {
  const r = raw as { schedules?: unknown } | null;
  if (!r || !Array.isArray(r.schedules)) return null;

  const schedules: ProposedSchedule[] = [];
  const typeNames: string[] = [];
  for (const item of r.schedules.slice(0, MAX_SCHEDULES)) {
    const it = item as {
      class_type?: unknown;
      days?: unknown;
      times?: unknown;
      duration_minutes?: unknown;
      capacity?: unknown;
    };
    const name = cleanName(it.class_type);
    if (!name) continue;
    const days = Array.isArray(it.days)
      ? [
          ...new Set(
            it.days.filter(
              (d): d is number =>
                typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    const times = Array.isArray(it.times)
      ? [
          ...new Set(
            it.times
              .slice(0, MAX_TIMES_PER_SCHEDULE)
              .map(cleanTime)
              .filter((t): t is string => t !== null),
          ),
        ].sort()
      : [];
    if (days.length === 0 || times.length === 0) continue;
    const duration = clampInt(it.duration_minutes, 15, 180, 60);
    const capacity = clampInt(it.capacity, 1, 200, 16);
    schedules.push({
      class_type: name,
      days,
      times,
      duration_minutes: duration as number,
      capacity: capacity as number,
    });
    if (!typeNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      typeNames.push(name);
    }
  }

  if (schedules.length === 0 || typeNames.length > MAX_CLASS_TYPES) return null;

  return {
    class_types: typeNames.map((name, i) => ({
      name,
      color: CLASS_TYPE_PALETTE[i % CLASS_TYPE_PALETTE.length],
    })),
    schedules,
  };
}

const PLAN_KINDS: PlanKind[] = [
  'unlimited',
  'credit_period',
  'credit_pack',
  'programming_only',
];

export function sanitisePlans(raw: unknown): PlansProposal | null {
  const r = raw as { plans?: unknown } | null;
  if (!r || !Array.isArray(r.plans)) return null;

  const plans: ProposedPlan[] = [];
  for (const item of r.plans.slice(0, MAX_PLANS)) {
    const it = item as {
      name?: unknown;
      kind?: unknown;
      monthly_price_cents?: unknown;
      credit_count?: unknown;
      blurb?: unknown;
    };
    const name = cleanName(it.name);
    if (!name) continue;
    if (plans.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    const kind = PLAN_KINDS.includes(it.kind as PlanKind)
      ? (it.kind as PlanKind)
      : 'unlimited';
    const price = clampInt(it.monthly_price_cents, 0, 100_000_00, null);
    const credits =
      kind === 'credit_period' || kind === 'credit_pack'
        ? clampInt(it.credit_count, 1, 100, 8)
        : null;
    // A paid recurring plan with no price is a parse failure, not a free
    // plan — dropping it beats selling memberships at £0 by accident.
    if (kind !== 'credit_pack' && price === null) continue;
    const blurb =
      typeof it.blurb === 'string' ? it.blurb.trim().slice(0, 80) : '';
    plans.push({
      name,
      kind,
      monthly_price_cents: price,
      credit_count: credits,
      blurb,
    });
  }

  if (plans.length === 0) return null;
  return { plans };
}

export function timetableSummary(p: TimetableProposal): string {
  const perWeek = p.schedules.reduce(
    (sum, s) => sum + s.days.length * s.times.length,
    0,
  );
  const caps = [...new Set(p.schedules.map((s) => s.capacity))];
  const capText =
    caps.length === 1 ? `, all capped at ${caps[0]}` : '';
  return `${perWeek} class${perWeek === 1 ? '' : 'es'} a week${capText}.`;
}

export function formatPrice(cents: number | null): string {
  if (cents === null) return '';
  const pounds = cents / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Groups a schedule's days for the preview card: contiguous runs
// collapse ("Mon–Fri"), stragglers list out ("Mon–Fri, Sat").
export function formatDays(days: number[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_SHORT[run[0]]}–${DAY_SHORT[run[run.length - 1]]}`
        : run.map((d) => DAY_SHORT[d]).join(', '),
    )
    .join(', ');
}
