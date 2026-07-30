// Applies a confirmed day-one proposal through the same writes the
// manual editors use — direct RLS inserts for class types, recurrences
// and plans, `set_gym_operating_defaults` for the gym row — so setup
// holds no write power of its own: the owner's session is the authority,
// and anything RLS would refuse the editors it refuses here too.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LATE_CANCEL_ABS,
  LATE_CANCEL_REL,
  type PlansProposal,
  type ProposedPlan,
  type ProposedSchedule,
  type RuleChoices,
  type TimetableProposal,
} from './setup-flow';

const HORIZON_WEEKS_FALLBACK = 12;

export function fmtDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function horizonEnd(today: Date, weeks: number): string {
  const end = new Date(today);
  end.setDate(end.getDate() + weeks * 7);
  return fmtDateLocal(end);
}

export function classTypeInsert(
  gymId: string,
  ct: { name: string; color: string },
) {
  // Booking/cancel fields stay null here — the rules step writes the
  // cancel policy afterwards, and null means "inherit the gym default".
  return {
    gym_id: gymId,
    name: ct.name,
    color: ct.color,
    booking_window_hours_ahead: null,
    booking_cutoff_minutes_before: null,
    cancel_cutoff_minutes_before: null,
    cancel_cutoff_mode: null,
    cancel_cutoff_time: null,
    cancel_cutoff_days_before: null,
  };
}

export function recurrenceInsert(
  gymId: string,
  classTypeId: string,
  s: ProposedSchedule,
  tz: string,
  todayStr: string,
  userId: string,
) {
  return {
    gym_id: gymId,
    class_type_id: classTypeId,
    days_of_week: s.days,
    times: s.times,
    duration_minutes: s.duration_minutes,
    capacity: s.capacity,
    notes: null,
    starts_on: todayStr,
    ends_on: null,
    tz,
    created_by: userId,
  };
}

export function planInsert(gymId: string, p: ProposedPlan) {
  return {
    gym_id: gymId,
    name: p.name,
    kind: p.kind,
    credit_count: p.credit_count,
    monthly_price_cents: p.monthly_price_cents,
    notice_period_days: p.notice_period_days,
    // A programming-only plan is individual programming and nothing
    // else; the CHECK at 0123:116 refuses the row without this, and
    // gym.add_plans advertises the kind, so hardcoding false made that
    // sentence fail with a raw Postgres error.
    includes_individual_programming: p.kind === 'programming_only',
    ...(p.kind === 'credit_period' ? { period_length: '30 days' } : {}),
  };
}

type GymOperatingRow = {
  week_starts_on: string;
  timezone: string;
  default_class_capacity: number;
  default_class_minutes: number;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  lead_conversion_window_days: number;
  subscription_resolution: string;
  cancel_cutoff_days_before: number | null;
  cover_warning_hours: number | null;
};

export function operatingDefaultsArgs(
  gymId: string,
  current: GymOperatingRow,
  defaults: { capacity: number; minutes: number },
  choices: RuleChoices,
) {
  return {
    p_gym_id: gymId,
    p_week_starts_on: choices.week_starts_on,
    p_timezone: current.timezone,
    p_default_class_capacity: defaults.capacity,
    p_default_class_minutes: defaults.minutes,
    p_expiring_within_days: choices.expiring_within_days,
    p_parq_expiry_days: choices.parq_expiry_days,
    p_health_retention_months: choices.health_retention_months,
    p_lead_conversion_window_days: choices.lead_conversion_window_days,
    p_subscription_resolution: current.subscription_resolution,
    p_booking_window_hours_ahead: choices.booking_window_hours_ahead,
    p_booking_cutoff_minutes_before: choices.booking_cutoff_minutes_before,
    p_cancel_cutoff_minutes_before: 0,
    // Gym-level day_before is retired — the class-type override owns the
    // absolute cutoff (see operating.tsx), so the gym row stays relative.
    p_cancel_cutoff_mode: 'relative',
    p_cancel_cutoff_time: null,
    p_cancel_cutoff_days_before: current.cancel_cutoff_days_before ?? 1,
    p_cover_warning_hours: choices.cover_warning_hours,
  };
}

export function classCancelPolicyUpdate(choices: RuleChoices) {
  const abs = LATE_CANCEL_ABS.exec(choices.late_cancel);
  if (abs) {
    return {
      cancel_cutoff_mode: 'day_before',
      cancel_cutoff_time: `${abs[1]}:${abs[2]}`,
      cancel_cutoff_days_before: 1,
      cancel_cutoff_minutes_before: 0,
    };
  }
  const rel = LATE_CANCEL_REL.exec(choices.late_cancel);
  return {
    cancel_cutoff_mode: 'relative',
    cancel_cutoff_time: null,
    cancel_cutoff_days_before: 1,
    cancel_cutoff_minutes_before: rel ? Number(rel[1]) : 0,
  };
}

export async function applyTimetable(
  supabase: SupabaseClient,
  gymId: string,
  tz: string,
  proposal: TimetableProposal,
): Promise<void> {
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');

  const { data: gym } = await supabase
    .from('gyms')
    .select('materialisation_horizon_weeks')
    .eq('id', gymId)
    .single();
  const weeks =
    (gym as { materialisation_horizon_weeks?: number } | null)
      ?.materialisation_horizon_weeks ?? HORIZON_WEEKS_FALLBACK;

  const today = new Date();
  const todayStr = fmtDateLocal(today);
  const untilDate = horizonEnd(today, weeks);

  // A proposed type whose name matches one the gym already has reuses it
  // — "add a Saturday CrossFit at 10" on a live gym must not mint a
  // second CrossFit. On day one this map is simply empty.
  const idByName = new Map<string, string>();
  const { data: existing } = await supabase
    .from('class_types')
    .select('id, name')
    .eq('gym_id', gymId)
    .is('archived_at', null);
  for (const row of (existing ?? []) as { id: string; name: string }[]) {
    idByName.set(row.name.toLowerCase(), row.id);
  }

  for (const ct of proposal.class_types) {
    if (idByName.has(ct.name.toLowerCase())) continue;
    const { data, error } = await supabase
      .from('class_types')
      .insert(classTypeInsert(gymId, ct))
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('Could not create class type');
    idByName.set(ct.name.toLowerCase(), (data as { id: string }).id);
  }

  for (const s of proposal.schedules) {
    const classTypeId = idByName.get(s.class_type.toLowerCase());
    if (!classTypeId) continue;
    const { data, error } = await supabase
      .from('class_recurrences')
      .insert(
        recurrenceInsert(gymId, classTypeId, s, tz, todayStr, userResp.user.id),
      )
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('Could not save schedule');
    const { error: extErr } = await supabase.rpc('extend_recurrence', {
      rec_id: (data as { id: string }).id,
      until_date: untilDate,
    });
    if (extErr) throw extErr;
  }
}

export async function applyPlans(
  supabase: SupabaseClient,
  gymId: string,
  proposal: PlansProposal,
): Promise<void> {
  for (const p of proposal.plans) {
    const { error } = await supabase
      .from('membership_plans')
      .insert(planInsert(gymId, p));
    if (error) throw error;
  }
}

export async function applyRules(
  supabase: SupabaseClient,
  gymId: string,
  defaults: { capacity: number; minutes: number },
  choices: RuleChoices,
  // The class-type cancel rewrite is opt-out: day-one setup always wants
  // it, but a Timeline change to an unrelated field must not flatten
  // per-type overrides the editor has since customised.
  opts: { touchCancelPolicy?: boolean } = {},
): Promise<void> {
  const touchCancelPolicy = opts.touchCancelPolicy ?? true;
  const { data, error } = await supabase
    .from('gyms')
    .select(
      'week_starts_on, timezone, default_class_capacity, default_class_minutes, expiring_within_days, parq_expiry_days, health_retention_months, lead_conversion_window_days, subscription_resolution, cancel_cutoff_days_before, cover_warning_hours',
    )
    .eq('id', gymId)
    .single();
  if (error || !data) throw error ?? new Error('Could not read gym settings');

  const { error: rpcErr } = await supabase.rpc(
    'set_gym_operating_defaults',
    operatingDefaultsArgs(gymId, data as GymOperatingRow, defaults, choices),
  );
  if (rpcErr) throw rpcErr;

  if (touchCancelPolicy) {
    const { error: updErr } = await supabase
      .from('class_types')
      .update(classCancelPolicyUpdate(choices))
      .eq('gym_id', gymId);
    if (updErr) throw updErr;
  }

  const { error: reqErr } = await supabase.rpc(
    'set_require_membership_to_book',
    { p_gym_id: gymId, p_enabled: choices.require_membership_to_book },
  );
  if (reqErr) throw reqErr;

  // The rest of the sheet, each through its own existing setter — the
  // same calls the Settings cards make, one per decision.
  const calls: [string, Record<string, unknown>][] = [
    ['set_allow_minors', { p_gym_id: gymId, p_enabled: choices.allow_minors }],
    ['set_gym_weight_unit', { p_gym_id: gymId, p_unit: choices.weight_unit }],
    ['set_dm_scope', { p_gym_id: gymId, p_scope: choices.dm_scope }],
    [
      'set_leaderboard_config',
      {
        p_gym_id: gymId,
        p_class_enabled: choices.leaderboards_on,
        p_strength_enabled: choices.leaderboards_on,
      },
    ],
    ['set_gym_public_signup', { p_gym_id: gymId, p_enabled: choices.public_signup }],
    [
      'set_gym_public_lead_capture',
      { p_gym_id: gymId, p_enabled: choices.public_lead_capture },
    ],
  ];
  for (const [fn, args] of calls) {
    const { error: e } = await supabase.rpc(fn, args);
    if (e) throw e;
  }
}
