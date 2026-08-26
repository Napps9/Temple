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
  'show_class_capacity, billing_anchor_day, ' +
  'public_signup_enabled, public_lead_capture_enabled, ' +
  'members_can_self_checkout, ' +
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
  show_class_capacity: boolean;
  billing_anchor_day: number | null;
  strength_leaderboards_enabled: boolean;
  public_signup_enabled: boolean;
  public_lead_capture_enabled: boolean;
  members_can_self_checkout: boolean;
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
    return gymCancelMinutes > 0 ? `rel:${gymCancelMinutes}` : 'never';
  }
  const counts = new Map<LateCancel, number>();
  for (const t of types) {
    const mode = t.cancel_cutoff_mode;
    let value: LateCancel;
    if (mode === 'day_before') {
      value = `abs:${(t.cancel_cutoff_time ?? '21:00').slice(0, 5)}`;
    } else {
      const minutes =
        mode === 'relative'
          ? (t.cancel_cutoff_minutes_before ?? 0)
          : t.cancel_cutoff_minutes_before !== null
            ? t.cancel_cutoff_minutes_before
            : gymCancelMinutes;
      value = minutes > 0 ? `rel:${minutes}` : 'never';
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Ties break toward the strictest reading so the sheet never promises a
  // free cancel the booking trigger would charge for: an absolute cutoff
  // the night before beats any relative one, and a longer relative window
  // beats a shorter one.
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || strictness(b[0]) - strictness(a[0]),
  )[0][0];
}

function strictness(value: LateCancel): number {
  if (value === 'never') return -1;
  if (value.startsWith('abs:')) return Number.MAX_SAFE_INTEGER;
  return Number(value.slice(4)) || 0;
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
    show_class_capacity: gym.show_class_capacity,
    billing_anchor_day: gym.billing_anchor_day ?? 0,
    public_signup: gym.public_signup_enabled,
    public_lead_capture: gym.public_lead_capture_enabled,
    members_can_self_checkout: gym.members_can_self_checkout,
    expiring_within_days: gym.expiring_within_days,
    parq_expiry_days: gym.parq_expiry_days,
    health_retention_months: gym.health_retention_months,
    cover_warning_hours: gym.cover_warning_hours,
    lead_conversion_window_days: gym.lead_conversion_window_days,
  };
}
