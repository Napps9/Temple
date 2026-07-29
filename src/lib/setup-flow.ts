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
  notice_period_days: number | null;
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
  allow_minors: boolean;
  weight_unit: 'kg' | 'lb';
  dm_scope: 'full_gym' | 'member_coach_only';
  leaderboards_on: boolean;
  public_signup: boolean;
  public_lead_capture: boolean;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  cover_warning_hours: number;
  lead_conversion_window_days: number;
};

// Defaults mirror what a fresh gym gets today, so an owner who taps
// straight through changes nothing they didn't choose to change.
export const DEFAULT_RULE_CHOICES: RuleChoices = {
  booking_window_hours_ahead: 168,
  late_cancel: 'day_before_21',
  booking_cutoff_minutes_before: 0,
  require_membership_to_book: true,
  week_starts_on: 'mon',
  allow_minors: false,
  weight_unit: 'kg',
  dm_scope: 'full_gym',
  leaderboards_on: true,
  public_signup: true,
  public_lead_capture: true,
  expiring_within_days: 14,
  parq_expiry_days: 365,
  health_retention_months: 3,
  cover_warning_hours: 48,
  lead_conversion_window_days: 30,
};

export type RuleField = keyof RuleChoices;

type FieldOption = { label: string; value: RuleChoices[RuleField] };

// One option set per field. These power both the question chips and the
// tappable value tokens in the rule sheet — same values, same labels, so
// a rule reads identically whether it was answered or edited.
export const RULE_FIELD_OPTIONS: Record<RuleField, FieldOption[]> = {
  booking_window_hours_ahead: [
    { label: '7 days', value: 168 },
    { label: '3 days', value: 72 },
    { label: '2 weeks', value: 336 },
    { label: 'no limit', value: null },
  ],
  late_cancel: [
    { label: 'from 9pm the night before', value: 'day_before_21' },
    { label: 'from 2 hours before', value: 'two_hours' },
    { label: 'never', value: 'never' },
  ],
  booking_cutoff_minutes_before: [
    { label: 'right up to the start', value: 0 },
    { label: 'until 30 minutes before', value: 30 },
    { label: 'until an hour before', value: 60 },
  ],
  require_membership_to_book: [
    { label: 'need a membership to book', value: true },
    { label: 'can book without a membership', value: false },
  ],
  week_starts_on: [
    { label: 'Monday', value: 'mon' },
    { label: 'Sunday', value: 'sun' },
  ],
  allow_minors: [
    { label: 'not allowed', value: false },
    { label: 'allowed, with a guardian', value: true },
  ],
  weight_unit: [
    { label: 'kilograms', value: 'kg' },
    { label: 'pounds', value: 'lb' },
  ],
  dm_scope: [
    { label: 'anyone in the gym', value: 'full_gym' },
    { label: 'coaches and staff only', value: 'member_coach_only' },
  ],
  leaderboards_on: [
    { label: 'on', value: true },
    { label: 'off', value: false },
  ],
  public_signup: [
    { label: 'can join', value: true },
    { label: 'cannot join', value: false },
  ],
  public_lead_capture: [
    { label: 'on', value: true },
    { label: 'off', value: false },
  ],
  expiring_within_days: [
    { label: '14 days', value: 14 },
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
  ],
  parq_expiry_days: [
    { label: 'year', value: 365 },
    { label: '6 months', value: 182 },
    { label: '2 years', value: 730 },
  ],
  health_retention_months: [
    { label: '3 months', value: 3 },
    { label: '1 month', value: 1 },
    { label: '6 months', value: 6 },
  ],
  cover_warning_hours: [
    { label: '48 hours', value: 48 },
    { label: '24 hours', value: 24 },
    { label: 'a week', value: 168 },
    { label: 'never', value: 0 },
  ],
  lead_conversion_window_days: [
    { label: '30 days', value: 30 },
    { label: '14 days', value: 14 },
    { label: '60 days', value: 60 },
  ],
};

// Off-menu values (a gym configured before the sheet existed, or a
// sentence like "make it 5 days") still read as English, not as a bare
// number mid-sentence.
export function formatRuleValue(
  field: RuleField,
  value: RuleChoices[RuleField],
): string {
  if (typeof value !== 'number') return String(value);
  switch (field) {
    case 'booking_window_hours_ahead':
      if (value % 168 === 0) {
        const w = value / 168;
        return w === 1 ? '1 week' : `${w} weeks`;
      }
      if (value % 24 === 0 && value >= 48) return `${value / 24} days`;
      return value === 1 ? '1 hour' : `${value} hours`;
    case 'booking_cutoff_minutes_before':
      if (value === 0) return 'right up to the start';
      if (value % 60 === 0) {
        const h = value / 60;
        return h === 1 ? 'until an hour before' : `until ${h} hours before`;
      }
      return `until ${value} minutes before`;
    case 'cover_warning_hours':
      if (value === 0) return 'never';
      if (value % 168 === 0) return value === 168 ? 'a week' : `${value / 168} weeks`;
      if (value % 24 === 0 && value >= 48) return `${value / 24} days`;
      return `${value} hours`;
    case 'parq_expiry_days':
      if (value % 365 === 0) {
        const y = value / 365;
        return y === 1 ? 'year' : `${y} years`;
      }
      return `${value} days`;
    case 'health_retention_months':
      return value === 1 ? '1 month' : `${value} months`;
    case 'expiring_within_days':
    case 'lead_conversion_window_days':
      return value === 1 ? '1 day' : `${value} days`;
    default:
      return String(value);
  }
}

export function fieldLabel(field: RuleField, c: RuleChoices): string {
  const opt = RULE_FIELD_OPTIONS[field].find((o) => o.value === c[field]);
  return opt ? opt.label : formatRuleValue(field, c[field]);
}

export type RuleQuestion = {
  id: RuleField;
  prompt: string;
  options: FieldOption[];
};

// The five big rules stay one-tap questions; everything else lives in
// the rule sheet as an editable default. Question chips are Sentence
// case where the token labels are mid-sentence, hence the overrides.
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

// A rule sentence with its editable value marked: text runs and tokens.
export type SheetPart = { t: string } | { f: RuleField };
export type SheetLine = { parts: SheetPart[] };
export type SheetGroup = { group: string; fine: boolean; lines: SheetLine[] };

function line(...parts: SheetPart[]): SheetLine {
  return { parts };
}

// Every configurable the old checklists scattered across Settings,
// grouped and spoken as sentences. `fine: true` groups collapse behind
// "the small print" — sensible defaults an owner can ignore on day one.
export function ruleSheet(c: RuleChoices): SheetGroup[] {
  const bookingLines: SheetLine[] = [
    c.booking_window_hours_ahead === null
      ? line({ t: 'Classes can be booked with ' }, { f: 'booking_window_hours_ahead' })
      : line({ t: 'Classes can be booked ' }, { f: 'booking_window_hours_ahead' }, { t: ' ahead' }),
    line({ t: 'Booking stays open ' }, { f: 'booking_cutoff_minutes_before' }),
    c.late_cancel === 'never'
      ? line({ t: 'Cancelling ' }, { f: 'late_cancel' }, { t: ' costs the credit' })
      : line({ t: 'Cancelling costs the credit ' }, { f: 'late_cancel' }),
    line({ t: 'People ' }, { f: 'require_membership_to_book' }),
  ];
  return [
    { group: 'Booking', fine: false, lines: bookingLines },
    {
      group: 'Your gym',
      fine: false,
      lines: [
        line({ t: 'The week starts on ' }, { f: 'week_starts_on' }),
        line({ t: 'Weights are shown in ' }, { f: 'weight_unit' }),
        line({ t: 'Under-18s are ' }, { f: 'allow_minors' }),
        line({ t: 'Members can message ' }, { f: 'dm_scope' }),
        line({ t: 'Leaderboards are ' }, { f: 'leaderboards_on' }),
        line({ t: 'People ' }, { f: 'public_signup' }, { t: ' from your website' }),
        line({ t: 'The enquiry form is ' }, { f: 'public_lead_capture' }),
      ],
    },
    {
      group: 'The small print',
      fine: true,
      lines: [
        line({ t: 'Memberships show as expiring ' }, { f: 'expiring_within_days' }, { t: ' out' }),
        line({ t: 'Health questionnaires renew every ' }, { f: 'parq_expiry_days' }),
        line({ t: 'Health data is deleted ' }, { f: 'health_retention_months' }, { t: ' after someone leaves' }),
        line({ t: 'Uncovered classes raise a warning ' }, { f: 'cover_warning_hours' }, { t: ' ahead' }),
        line({ t: 'Leads count as converted within ' }, { f: 'lead_conversion_window_days' }),
      ],
    },
  ];
}

export function sheetLineText(l: SheetLine, c: RuleChoices): string {
  return l.parts
    .map((p) => ('t' in p ? p.t : fieldLabel(p.f, c)))
    .join('');
}

export function ruleSentences(c: RuleChoices): string[] {
  const out = ruleSheet(c).flatMap((g) =>
    g.lines.map((l) => sheetLineText(l, c)),
  );
  out.push('Waitlist fills empty spots automatically');
  out.push('Waiver signed before the first class');
  return out;
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
      notice_period_days?: unknown;
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
    // A plan with no price is a parse failure, not a free plan —
    // dropping it beats selling memberships (or packs) at £0 by accident.
    if (price === null) continue;
    const blurb =
      typeof it.blurb === 'string' ? it.blurb.trim().slice(0, 80) : '';
    plans.push({
      name,
      kind,
      monthly_price_cents: price,
      credit_count: credits,
      notice_period_days: clampInt(it.notice_period_days, 0, 90, null),
      blurb,
    });
  }

  if (plans.length === 0) return null;
  return { plans };
}

export type RuleChange = { field: RuleField; value: RuleChoices[RuleField] };

// Numeric fields accept off-menu values from a sentence ("make it 5
// days"), clamped to sane bounds; enum and boolean fields must land on a
// real option. booking_window_hours_ahead additionally accepts null
// ("no limit").
const NUMERIC_RULE_BOUNDS: Partial<Record<RuleField, [number, number]>> = {
  booking_window_hours_ahead: [1, 2160],
  booking_cutoff_minutes_before: [0, 1440],
  expiring_within_days: [1, 90],
  parq_expiry_days: [30, 1095],
  health_retention_months: [1, 24],
  cover_warning_hours: [0, 336],
  lead_conversion_window_days: [7, 365],
};

// Model output is untrusted: every change is re-validated against the
// option table (or the numeric bounds), no-ops are dropped, and a
// request that survives with nothing left returns null so the UI never
// shows an empty "confirm this" card.
export function sanitiseRuleChanges(
  raw: unknown,
  current: RuleChoices,
): RuleChange[] | null {
  const r = raw as { changes?: unknown } | null;
  if (!r || !Array.isArray(r.changes)) return null;

  const byField = new Map<RuleField, RuleChange>();
  for (const item of r.changes.slice(0, 16)) {
    const it = item as { field?: unknown; value?: unknown };
    const field = it.field as RuleField;
    if (typeof field !== 'string' || !(field in RULE_FIELD_OPTIONS)) continue;

    let value: RuleChoices[RuleField] | undefined;
    const bounds = NUMERIC_RULE_BOUNDS[field];
    if (bounds) {
      if (it.value === null && field === 'booking_window_hours_ahead') {
        value = null;
      } else if (
        typeof it.value === 'number' &&
        Number.isFinite(it.value)
      ) {
        const n = Math.round(it.value);
        if (n >= bounds[0] && n <= bounds[1]) value = n;
      }
    } else {
      const opt = RULE_FIELD_OPTIONS[field].find((o) => o.value === it.value);
      if (opt) value = opt.value;
    }
    if (value === undefined) continue;
    if (value === current[field]) continue;
    byField.set(field, { field, value });
  }

  const changes = [...byField.values()];
  return changes.length > 0 ? changes : null;
}

// The rule's own sheet sentence, so a rule reads the same whether it was
// tapped, typed, or edited in the sheet.
export function ruleSentence(field: RuleField, choices: RuleChoices): string {
  const sheetLine = ruleSheet(choices)
    .flatMap((g) => g.lines)
    .find((l) => l.parts.some((p) => 'f' in p && p.f === field));
  return sheetLine ? sheetLineText(sheetLine, choices) : '';
}

// "Cancelling costs the credit: from 9pm the night before → from 2 hours
// before" — the confirm card's line per change.
export function ruleChangeLine(change: RuleChange, current: RuleChoices): string {
  const next = { ...current, [change.field]: change.value } as RuleChoices;
  return `${ruleSentence(change.field, next)} (was ${fieldLabel(change.field, current)})`;
}

// A typed answer can settle a question that hasn't been asked yet, so the
// run always resumes at the first question still unanswered rather than
// marching to the next one in line.
export function nextRuleQuestion(answers: Partial<RuleChoices>): number | null {
  const i = RULE_QUESTIONS.findIndex((q) => !(q.id in answers));
  return i === -1 ? null : i;
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
