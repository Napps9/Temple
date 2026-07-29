import { describe, expect, it } from 'vitest';

import {
  classCancelPolicyUpdate,
  classTypeInsert,
  fmtDateLocal,
  horizonEnd,
  operatingDefaultsArgs,
  planInsert,
  recurrenceInsert,
} from './setup-apply';
import { DEFAULT_RULE_CHOICES } from './setup-flow';

describe('timetable payloads', () => {
  it('creates class types with inherit-null booking and cancel fields', () => {
    const row = classTypeInsert('g1', { name: 'CrossFit', color: '#3B82F6' });
    expect(row.gym_id).toBe('g1');
    expect(row.booking_window_hours_ahead).toBeNull();
    expect(row.cancel_cutoff_mode).toBeNull();
  });

  it('builds recurrences on the editor shape, open-ended from today', () => {
    const row = recurrenceInsert(
      'g1',
      'ct1',
      { class_type: 'CrossFit', days: [1, 2], times: ['06:00'], duration_minutes: 60, capacity: 16 },
      'Europe/London',
      '2026-07-29',
      'u1',
    );
    expect(row).toMatchObject({
      gym_id: 'g1',
      class_type_id: 'ct1',
      days_of_week: [1, 2],
      times: ['06:00'],
      starts_on: '2026-07-29',
      ends_on: null,
      tz: 'Europe/London',
      created_by: 'u1',
    });
  });

  it('computes the materialisation horizon in local dates', () => {
    expect(horizonEnd(new Date(2026, 6, 29), 12)).toBe('2026-10-21');
    expect(fmtDateLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('plan payloads', () => {
  it('adds period_length only for credit_period plans', () => {
    const credit = planInsert('g1', {
      name: '8 classes', kind: 'credit_period', monthly_price_cents: 5900, credit_count: 8, blurb: '',
    });
    expect(credit).toMatchObject({ period_length: '30 days', credit_count: 8 });
    const unlimited = planInsert('g1', {
      name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900, credit_count: null, blurb: '',
    });
    expect('period_length' in unlimited).toBe(false);
  });
});

describe('rules payloads', () => {
  const current = {
    week_starts_on: 'mon',
    timezone: 'Europe/London',
    default_class_capacity: 12,
    default_class_minutes: 60,
    expiring_within_days: 14,
    parq_expiry_days: 365,
    health_retention_months: 3,
    lead_conversion_window_days: 30,
    subscription_resolution: 'newest',
    cancel_cutoff_days_before: null,
    cover_warning_hours: null,
  };

  it('applies the chosen booking rules and passes existing settings through', () => {
    const args = operatingDefaultsArgs('g1', current, { capacity: 16, minutes: 60 }, DEFAULT_RULE_CHOICES);
    expect(args.p_booking_window_hours_ahead).toBe(168);
    expect(args.p_booking_cutoff_minutes_before).toBe(0);
    expect(args.p_week_starts_on).toBe('mon');
    expect(args.p_default_class_capacity).toBe(16);
    expect(args.p_timezone).toBe('Europe/London');
    expect(args.p_parq_expiry_days).toBe(365);
    // Gym-level day_before is retired; the class-type override carries it.
    expect(args.p_cancel_cutoff_mode).toBe('relative');
    expect(args.p_cancel_cutoff_time).toBeNull();
  });

  it('honours a no-limit window and a Sunday week start', () => {
    const args = operatingDefaultsArgs('g1', current, { capacity: 12, minutes: 45 }, {
      ...DEFAULT_RULE_CHOICES,
      booking_window_hours_ahead: null,
      booking_cutoff_minutes_before: 30,
      week_starts_on: 'sun',
    });
    expect(args.p_booking_window_hours_ahead).toBeNull();
    expect(args.p_booking_cutoff_minutes_before).toBe(30);
    expect(args.p_week_starts_on).toBe('sun');
  });

  it('maps each late-cancel choice onto the class-type policy', () => {
    expect(classCancelPolicyUpdate(DEFAULT_RULE_CHOICES)).toEqual({
      cancel_cutoff_mode: 'day_before',
      cancel_cutoff_time: '21:00',
      cancel_cutoff_days_before: 1,
      cancel_cutoff_minutes_before: 0,
    });
    expect(classCancelPolicyUpdate({ ...DEFAULT_RULE_CHOICES, late_cancel: 'two_hours' })).toMatchObject({
      cancel_cutoff_mode: 'relative',
      cancel_cutoff_minutes_before: 120,
    });
    expect(classCancelPolicyUpdate({ ...DEFAULT_RULE_CHOICES, late_cancel: 'never' })).toMatchObject({
      cancel_cutoff_mode: 'relative',
      cancel_cutoff_minutes_before: 0,
    });
  });
});
