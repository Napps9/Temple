// Reads a live gym's settings back into the RuleChoices shape the rule
// sheet speaks — the reverse of setup-apply. Pure: the Timeline screen
// fetches the rows and this derives the choices, so the mapping is
// testable without a client. Any field the sheet then changes is applied
// through applyRules, which sends the server's values for everything
// else — the per-card-save discipline, one field at a time.

import type { LateCancel, RuleChoices } from './setup-flow';

export const GYM_RULES_SELECT =
  'booking_window_hours_ahead, booking_cutoff_minutes_before, ' +
  'cancel_cutoff_minutes_before, require_membership_to_book, ' +
  'week_starts_on, allow_minors, weight_unit, dm_scope, ' +
  'class_leaderboards_enabled, strength_leaderboards_enabled, ' +
  'public_signup_enabled, public_lead_capture_enabled, ' +
  'expiring_within_days, parq_expiry_days, health_retention_months, ' +
  'cover_warning_hours, lead_conversion_window_days, ' +
  'default_class_capacity, default_class_minutes';

export type GymRulesRow = {
  booking_window_hours_ahead: number | null;
  booking_cutoff_minutes_before: number;
  cancel_cutoff_minutes_before: number;
  require_membership_to_book: boolean;
  week_starts_on: 'mon' | 'sun';
  allow_minors: boolean;
  weight_unit: 'kg' | 'lb';
  dm_scope: 'full_gym' | 'member_coach_only';
  class_leaderboards_enabled: boolean;
  strength_leaderboards_enabled: boolean;
  public_signup_enabled: boolean;
  public_lead_capture_enabled: boolean;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  cover_warning_hours: number;
  lead_conversion_window_days: number;
  default_class_capacity: number;
  default_class_minutes: number;
};

export type ClassTypeCancelRow = {
  cancel_cutoff_mode: 'relative' | 'day_before' | null;
  cancel_cutoff_time: string | null;
  cancel_cutoff_minutes_before: number | null;
};

// The sheet's late-cancel line is the gym-wide rule; changing it rewrites
// every class type (applyRules), and a type the editor has customised
// keeps its override until then. Reading back: resolve each type's
// effective policy (null mode inherits the gym default), then majority
// vote — ties break toward the strictest reading so the sheet never
// promises a free cancel the booking trigger would charge for.
export function lateCancelFromClassTypes(
  gymCancelMinutes: number,
  types: ClassTypeCancelRow[],
): LateCancel {
  if (types.length === 0) {
    return gymCancelMinutes > 0 ? 'two_hours' : 'never';
  }
  const counts: Record<LateCancel, number> = {
    day_before_21: 0,
    two_hours: 0,
    never: 0,
  };
  for (const t of types) {
    const mode = t.cancel_cutoff_mode;
    if (mode === 'day_before') {
      counts.day_before_21 += 1;
      continue;
    }
    const minutes =
      mode === 'relative'
        ? (t.cancel_cutoff_minutes_before ?? 0)
        : t.cancel_cutoff_mode === null && t.cancel_cutoff_minutes_before !== null
          ? t.cancel_cutoff_minutes_before
          : gymCancelMinutes;
    if (minutes > 0) counts.two_hours += 1;
    else counts.never += 1;
  }
  const order: LateCancel[] = ['day_before_21', 'two_hours', 'never'];
  return order.reduce((best, k) => (counts[k] > counts[best] ? k : best));
}

export function choicesFromGym(
  gym: GymRulesRow,
  classTypes: ClassTypeCancelRow[],
): RuleChoices {
  return {
    booking_window_hours_ahead: gym.booking_window_hours_ahead,
    late_cancel: lateCancelFromClassTypes(
      gym.cancel_cutoff_minutes_before,
      classTypes,
    ),
    booking_cutoff_minutes_before: gym.booking_cutoff_minutes_before,
    require_membership_to_book: gym.require_membership_to_book,
    week_starts_on: gym.week_starts_on,
    allow_minors: gym.allow_minors,
    weight_unit: gym.weight_unit,
    dm_scope: gym.dm_scope,
    leaderboards_on:
      gym.class_leaderboards_enabled || gym.strength_leaderboards_enabled,
    public_signup: gym.public_signup_enabled,
    public_lead_capture: gym.public_lead_capture_enabled,
    expiring_within_days: gym.expiring_within_days,
    parq_expiry_days: gym.parq_expiry_days,
    health_retention_months: gym.health_retention_months,
    cover_warning_hours: gym.cover_warning_hours,
    lead_conversion_window_days: gym.lead_conversion_window_days,
  };
}
