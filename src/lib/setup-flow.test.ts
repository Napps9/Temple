import { describe, expect, it } from 'vitest';

import {
  CLASS_TYPE_PALETTE,
  formatDays,
  formatPrice,
  sanitisePlans,
  sanitiseTimetable,
  timetableSummary,
} from './setup-flow';

describe('sanitiseTimetable', () => {
  const good = {
    schedules: [
      {
        class_type: 'CrossFit',
        days: [1, 2, 3, 4, 5],
        times: ['06:00', '07:00', '09:30', '18:00'],
        duration_minutes: 60,
        capacity: 16,
      },
      {
        class_type: 'CrossFit',
        days: [6],
        times: ['09:00'],
        duration_minutes: 60,
        capacity: 16,
      },
    ],
  };

  it('accepts a clean proposal and derives the class-type list', () => {
    const p = sanitiseTimetable(good);
    expect(p).not.toBeNull();
    expect(p!.class_types).toEqual([
      { name: 'CrossFit', color: CLASS_TYPE_PALETTE[0] },
    ]);
    expect(p!.schedules).toHaveLength(2);
  });

  it('dedupes class-type names case-insensitively', () => {
    const p = sanitiseTimetable({
      schedules: [
        { ...good.schedules[0], class_type: 'crossfit' },
        { ...good.schedules[1], class_type: 'CrossFit' },
      ],
    });
    expect(p!.class_types).toHaveLength(1);
  });

  it('drops schedules with no valid days or times, and rejects an empty result', () => {
    expect(
      sanitiseTimetable({
        schedules: [
          { class_type: 'X', days: [9], times: ['06:00'], duration_minutes: 60, capacity: 10 },
          { class_type: 'Y', days: [1], times: ['25:99'], duration_minutes: 60, capacity: 10 },
        ],
      }),
    ).toBeNull();
  });

  it('normalises and bounds times, days, duration and capacity', () => {
    const p = sanitiseTimetable({
      schedules: [
        {
          class_type: 'Barbell',
          days: [5, 1, 1, 3],
          times: ['6:00', '06:00', '23:59', 'noon'],
          duration_minutes: 999,
          capacity: -3,
        },
      ],
    });
    const s = p!.schedules[0];
    expect(s.days).toEqual([1, 3, 5]);
    expect(s.times).toEqual(['06:00']);
    expect(s.duration_minutes).toBe(60);
    expect(s.capacity).toBe(16);
  });

  it('rejects non-objects and missing schedules', () => {
    expect(sanitiseTimetable(null)).toBeNull();
    expect(sanitiseTimetable('week')).toBeNull();
    expect(sanitiseTimetable({})).toBeNull();
  });
});

describe('sanitisePlans', () => {
  it('accepts a clean set and defaults kind to unlimited', () => {
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900, credit_count: null, blurb: 'every class' },
        { name: '8 classes', kind: 'credit_period', monthly_price_cents: 5900, credit_count: 8, blurb: 'a month' },
      ],
    });
    expect(p!.plans).toHaveLength(2);
    expect(p!.plans[1].credit_count).toBe(8);
  });

  it('drops a recurring plan with no price rather than selling it free', () => {
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: null },
        { name: 'Student', kind: 'unlimited', monthly_price_cents: 4500 },
      ],
    });
    expect(p!.plans.map((x) => x.name)).toEqual(['Student']);
  });

  it('dedupes names and rejects an all-invalid set', () => {
    expect(
      sanitisePlans({ plans: [{ name: 'X', kind: 'unlimited', monthly_price_cents: null }] }),
    ).toBeNull();
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900 },
        { name: 'unlimited', kind: 'unlimited', monthly_price_cents: 9900 },
      ],
    });
    expect(p!.plans).toHaveLength(1);
  });
});

describe('summaries and formatting', () => {
  it('counts classes per week and notices a shared cap', () => {
    const p = sanitiseTimetable({
      schedules: [
        { class_type: 'CrossFit', days: [1, 2, 3, 4, 5], times: ['06:00', '07:00', '09:30', '18:00'], duration_minutes: 60, capacity: 16 },
        { class_type: 'CrossFit', days: [6], times: ['09:00'], duration_minutes: 60, capacity: 16 },
      ],
    })!;
    expect(timetableSummary(p)).toBe('21 classes a week, all capped at 16.');
  });

  it('formats prices in whole pounds when possible', () => {
    expect(formatPrice(8900)).toBe('£89');
    expect(formatPrice(8950)).toBe('£89.50');
    expect(formatPrice(null)).toBe('');
  });

  it('collapses contiguous day runs', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(formatDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(formatDays([6])).toBe('Sat');
    expect(formatDays([0, 3])).toBe('Sun, Wed');
  });
});
