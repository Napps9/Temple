// Applies a confirmed day-one proposal through the same writes the
// manual editors use — direct RLS inserts for class types, recurrences
// and plans, `set_gym_operating_defaults` for the gym row — so setup
// holds no write power of its own: the owner's session is the authority,
// and anything RLS would refuse the editors it refuses here too.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  BEST_PRACTICE_RULES,
  type PlansProposal,
  type ProposedPlan,
  type ProposedSchedule,
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
    notice_period_days: null,
    includes_individual_programming: false,
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
) {
  return {
    p_gym_id: gymId,
    p_week_starts_on: current.week_starts_on,
    p_timezone: current.timezone,
    p_default_class_capacity: defaults.capacity,
    p_default_class_minutes: defaults.minutes,
    p_expiring_within_days: current.expiring_within_days,
    p_parq_expiry_days: current.parq_expiry_days,
    p_health_retention_months: current.health_retention_months,
    p_lead_conversion_window_days: current.lead_conversion_window_days,
    p_subscription_resolution: current.subscription_resolution,
    p_booking_window_hours_ahead:
      BEST_PRACTICE_RULES.booking_window_hours_ahead,
    p_booking_cutoff_minutes_before:
      BEST_PRACTICE_RULES.booking_cutoff_minutes_before,
    p_cancel_cutoff_minutes_before: 0,
    // Gym-level day_before is retired — the class-type override owns the
    // absolute cutoff (see operating.tsx), so the gym row stays relative.
    p_cancel_cutoff_mode: 'relative',
    p_cancel_cutoff_time: null,
    p_cancel_cutoff_days_before: current.cancel_cutoff_days_before ?? 1,
    p_cover_warning_hours: current.cover_warning_hours ?? 48,
  };
}

export function classCancelPolicyUpdate() {
  const c = BEST_PRACTICE_RULES.class_cancel;
  return {
    cancel_cutoff_mode: c.cancel_cutoff_mode,
    cancel_cutoff_time: c.cancel_cutoff_time,
    cancel_cutoff_days_before: c.cancel_cutoff_days_before,
    cancel_cutoff_minutes_before: c.cancel_cutoff_minutes_before,
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

  const idByName = new Map<string, string>();
  for (const ct of proposal.class_types) {
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
): Promise<void> {
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
    operatingDefaultsArgs(gymId, data as GymOperatingRow, defaults),
  );
  if (rpcErr) throw rpcErr;

  const { error: updErr } = await supabase
    .from('class_types')
    .update(classCancelPolicyUpdate())
    .eq('gym_id', gymId);
  if (updErr) throw updErr;
}
