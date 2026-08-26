import { describe, expect, it } from 'vitest';

import {
  choicesFromGym,
  lateCancelFromClassTypes,
  type GymRulesRow,
} from './rules-read';
import {
  DEFAULT_RULE_CHOICES,
  formatRuleValue,
  ruleChangeLine,
  sanitiseRuleChanges,
} from './setup-flow';

const FRESH_GYM: GymRulesRow = {
  booking_window_hours_ahead: 168,
  booking_cutoff_minutes_before: 0,
  cancel_cutoff_minutes_before: 0,
  require_membership_to_book: true,
  week_starts_on: 'mon',
  allow_minors: false,
  weight_unit: 'kg',
  dm_scope: 'full_gym',
  class_leaderboards_enabled: true,
  strength_leaderboards_enabled: true,
  show_class_capacity: true,
  billing_anchor_day: null,
  public_signup_enabled: true,
  public_lead_capture_enabled: true,
  members_can_self_checkout: true,
  expiring_within_days: 14,
  parq_expiry_days: 365,
  health_retention_months: 3,
  cover_warning_hours: 48,
  lead_conversion_window_days: 30,
  default_class_capacity: 16,
  default_class_minutes: 60,
};

describe('choicesFromGym', () => {
  it('round-trips a fresh gym onto the defaults', () => {
    const choices = choicesFromGym(FRESH_GYM, [
      {
        cancel_cutoff_mode: 'day_before',
        cancel_cutoff_time: '21:00',
        cancel_cutoff_minutes_before: 0,
      },
    ]);
    expect(choices).toEqual(DEFAULT_RULE_CHOICES);
  });

  it('reads mixed leaderboard flags as on', () => {
    const choices = choicesFromGym(
      { ...FRESH_GYM, class_leaderboards_enabled: false },
      [],
    );
    expect(choices.leaderboards_on).toBe(true);
  });
});

describe('lateCancelFromClassTypes', () => {
  it('majority vote across effective policies', () => {
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: 'day_before', cancel_cutoff_time: '21:00', cancel_cutoff_minutes_before: 0 },
        { cancel_cutoff_mode: 'day_before', cancel_cutoff_time: '21:00', cancel_cutoff_minutes_before: 0 },
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 120 },
      ]),
    ).toBe('abs:21:00');
  });

  it('reads back the time a gym actually set, not a preset', () => {
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: 'day_before', cancel_cutoff_time: '22:00:00', cancel_cutoff_minutes_before: 0 },
      ]),
    ).toBe('abs:22:00');
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 30 },
      ]),
    ).toBe('rel:30');
  });

  it('breaks a tie toward the stricter rule', () => {
    // One of each: the sheet must not promise the looser of the two.
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 30 },
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 120 },
      ]),
    ).toBe('rel:120');
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 0 },
        { cancel_cutoff_mode: 'relative', cancel_cutoff_time: null, cancel_cutoff_minutes_before: 60 },
      ]),
    ).toBe('rel:60');
  });

  it('a type inheriting the gym default counts the gym minutes', () => {
    expect(
      lateCancelFromClassTypes(120, [
        { cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_minutes_before: null },
      ]),
    ).toBe('rel:120');
    expect(
      lateCancelFromClassTypes(0, [
        { cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_minutes_before: null },
      ]),
    ).toBe('never');
  });

  it('no class types falls back to the gym relative minutes', () => {
    expect(lateCancelFromClassTypes(0, [])).toBe('never');
  });
});

describe('sanitiseRuleChanges', () => {
  it('accepts on-menu enum values and drops no-ops', () => {
    const changes = sanitiseRuleChanges(
      {
        changes: [
          { field: 'late_cancel', value: 'rel:120' },
          { field: 'week_starts_on', value: 'mon' },
        ],
      },
      DEFAULT_RULE_CHOICES,
    );
    expect(changes).toEqual([{ field: 'late_cancel', value: 'rel:120' }]);
  });

  it('accepts off-menu numbers within bounds, rejects outside', () => {
    const changes = sanitiseRuleChanges(
      {
        changes: [
          { field: 'booking_window_hours_ahead', value: 120 },
          { field: 'expiring_within_days', value: 9999 },
        ],
      },
      DEFAULT_RULE_CHOICES,
    );
    expect(changes).toEqual([
      { field: 'booking_window_hours_ahead', value: 120 },
    ]);
  });

  it('accepts null only for the booking window and refuses invented enums', () => {
    expect(
      sanitiseRuleChanges(
        { changes: [{ field: 'booking_window_hours_ahead', value: null }] },
        DEFAULT_RULE_CHOICES,
      ),
    ).toEqual([{ field: 'booking_window_hours_ahead', value: null }]);
    expect(
      sanitiseRuleChanges(
        { changes: [{ field: 'late_cancel', value: 'whenever' }] },
        DEFAULT_RULE_CHOICES,
      ),
    ).toBeNull();
  });

  it('returns null when nothing survives', () => {
    expect(sanitiseRuleChanges({ changes: [] }, DEFAULT_RULE_CHOICES)).toBeNull();
    expect(sanitiseRuleChanges(null, DEFAULT_RULE_CHOICES)).toBeNull();
  });
});

describe('formatRuleValue', () => {
  it('humanises off-menu numbers per field', () => {
    expect(formatRuleValue('booking_window_hours_ahead', 120)).toBe('5 days');
    expect(formatRuleValue('booking_window_hours_ahead', 336)).toBe('2 weeks');
    expect(formatRuleValue('booking_cutoff_minutes_before', 45)).toBe(
      'until 45 minutes before',
    );
    expect(formatRuleValue('parq_expiry_days', 730)).toBe('2 years');
    expect(formatRuleValue('cover_warning_hours', 72)).toBe('3 days');
  });
});

describe('ruleChangeLine', () => {
  it('speaks the changed sentence with the old value in brackets', () => {
    const line = ruleChangeLine(
      { field: 'late_cancel', value: 'rel:120' },
      DEFAULT_RULE_CHOICES,
    );
    expect(line).toBe(
      'Cancelling costs the credit from 2 hours before (was from 9pm the night before)',
    );
  });
});
