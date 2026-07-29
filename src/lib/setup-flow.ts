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

// The rules step is a short run of one-tap questions, each mapping onto
// a real setting: booking window and close-cutoff live on the gym, the
// late-cancel charge lives on each class type (gym-level day_before is
// retired — the booking trigger only honours the class-type override),
// membership-to-book is its own RPC, week start rides the operating
// defaults. The first option of each question is the best practice, so
// tapping straight down the list is the recommended setup.

export type LateCancel = 'day_before_21' | 'two_hours' | 'never';

export type RuleChoices = {
  booking_window_hours_ahead: number | null;
  late_cancel: LateCancel;
  booking_cutoff_minutes_before: number;
  require_membership_to_book: boolean;
  week_starts_on: 'mon' | 'sun';
};

export const DEFAULT_RULE_CHOICES: RuleChoices = {
  booking_window_hours_ahead: 168,
  late_cancel: 'day_before_21',
  booking_cutoff_minutes_before: 0,
  require_membership_to_book: true,
  week_starts_on: 'mon',
};

export type RuleQuestion = {
  id: keyof RuleChoices;
  prompt: string;
  options: { label: string; value: RuleChoices[keyof RuleChoices] }[];
};

export const RULE_QUESTIONS: RuleQuestion[] = [
  {
    id: 'booking_window_hours_ahead',
    prompt: 'How far ahead can members book a class?',
    options: [
      { label: '7 days', value: 168 },
      { label: '3 days', value: 72 },
      { label: '2 weeks', value: 336 },
      { label: 'No limit', value: null },
    ],
  },
  {
    id: 'late_cancel',
    prompt: 'When does cancelling start to cost the class credit?',
    options: [
      { label: 'From 9pm the night before', value: 'day_before_21' },
      { label: 'From 2 hours before', value: 'two_hours' },
      { label: 'Never — cancelling is always free', value: 'never' },
    ],
  },
  {
    id: 'booking_cutoff_minutes_before',
    prompt: 'How close to the start can people still book on?',
    options: [
      { label: 'Right up to the start', value: 0 },
      { label: 'Up to 30 minutes before', value: 30 },
      { label: 'Up to an hour before', value: 60 },
    ],
  },
  {
    id: 'require_membership_to_book',
    prompt: 'Can people book before they have a membership?',
    options: [
      { label: 'No — membership first', value: true },
      { label: 'Yes — anyone can book', value: false },
    ],
  },
  {
    id: 'week_starts_on',
    prompt: 'What day does your week start on?',
    options: [
      { label: 'Monday', value: 'mon' },
      { label: 'Sunday', value: 'sun' },
    ],
  },
];

export function mergeRuleAnswers(
  answers: Partial<RuleChoices>,
): RuleChoices {
  return { ...DEFAULT_RULE_CHOICES, ...answers };
}

export function ruleSentences(c: RuleChoices): string[] {
  const window =
    c.booking_window_hours_ahead === null
      ? 'Book any time — no limit'
      : c.booking_window_hours_ahead === 336
        ? 'Book up to 2 weeks ahead'
        : `Book up to ${Math.round(c.booking_window_hours_ahead / 24)} days ahead`;
  const cancel =
    c.late_cancel === 'day_before_21'
      ? 'Free cancel until 9pm the night before — later uses the class credit'
      : c.late_cancel === 'two_hours'
        ? 'Free cancel until 2 hours before — later uses the class credit'
        : 'Cancelling never costs a credit';
  const close =
    c.booking_cutoff_minutes_before === 0
      ? 'Book right up to the start'
      : `Booking closes ${c.booking_cutoff_minutes_before} minutes before`;
  const memb = c.require_membership_to_book
    ? 'Membership needed to book'
    : 'Anyone can book a class';
  const week = c.week_starts_on === 'mon' ? 'Week starts Monday' : 'Week starts Sunday';
  return [
    window,
    cancel,
    close,
    memb,
    week,
    'Waitlist fills empty spots automatically',
    'Waiver signed before the first class',
  ];
}

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
