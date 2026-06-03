import { describe, expect, it } from 'vitest';

import { addInterval, computePaidPeriodEnd } from './notice-math';

function d(iso: string): Date {
  return new Date(iso);
}

describe('addInterval', () => {
  it('adds months across year boundary', () => {
    expect(addInterval(d('2024-12-15T00:00:00Z'), { months: 2 }).toISOString()).toBe(
      '2025-02-15T00:00:00.000Z',
    );
  });

  it('adds days', () => {
    expect(addInterval(d('2024-03-01T00:00:00Z'), { days: 10 }).toISOString()).toBe(
      '2024-03-11T00:00:00.000Z',
    );
  });

  it('handles February month rollover', () => {
    // Jan 31 + 1 month → JS lands on Mar 3 (Feb has no 31st).
    // Matches Stripe's "anchored billing on 31st rolls to month end"
    // behaviour closely enough for preview math; the RPC's plpgsql
    // version is the source of truth on the SQL side.
    const r = addInterval(d('2024-01-31T00:00:00Z'), { months: 1 });
    expect(r.toISOString().slice(0, 10)).toBe('2024-03-02');
  });
});

describe('computePaidPeriodEnd — zero notice', () => {
  it('returns paidPeriodEnd unchanged', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: {},
    });
    expect(got.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });
});

describe('computePaidPeriodEnd — notice fits in current period', () => {
  it('keeps paidPeriodEnd', () => {
    // 30-day notice from 2024-03-01 → 2024-03-31, fits in period ending 2024-04-01.
    const got = computePaidPeriodEnd({
      now: d('2024-03-01T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });

  it('keeps paidPeriodEnd when notice expires exactly at end', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-02T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });
});

describe('computePaidPeriodEnd — notice extends past current period', () => {
  it('rounds up by one billing period for mid-period cancel', () => {
    // Cancel on 2024-03-15 with 30-day notice → expires 2024-04-14,
    // which lands in the next period (ends 2024-05-01).
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString()).toBe('2024-05-01T00:00:00.000Z');
  });

  it('60-day notice extends two periods when needed', () => {
    // Cancel on 2024-03-15 with 60-day notice → expires 2024-05-14,
    // which lands in the third period (ends 2024-06-01).
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: { days: 60 },
    });
    expect(got.toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('weekly billing rounds to next week end', () => {
    // Period ends Mar 8, cancel Mar 6 with 7-day notice expires Mar 13 → end Mar 15.
    const got = computePaidPeriodEnd({
      now: d('2024-03-06T00:00:00Z'),
      paidPeriodEnd: d('2024-03-08T00:00:00Z'),
      billingInterval: { days: 7 },
      noticePeriod: { days: 7 },
    });
    expect(got.toISOString()).toBe('2024-03-15T00:00:00.000Z');
  });

  it('preserves time-of-day on advance', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T12:00:00Z'),
      paidPeriodEnd: d('2024-04-01T14:30:00Z'),
      billingInterval: { months: 1 },
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString()).toBe('2024-05-01T14:30:00.000Z');
  });
});

describe('computePaidPeriodEnd — degenerate inputs', () => {
  it('falls back to now+notice when paidPeriodEnd is null', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: null,
      billingInterval: { months: 1 },
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString().slice(0, 10)).toBe('2024-04-14');
  });

  it('falls back to now+notice when billingInterval is null', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: null,
      noticePeriod: { days: 30 },
    });
    expect(got.toISOString().slice(0, 10)).toBe('2024-04-14');
  });

  it('handles empty billingInterval without hanging', () => {
    const got = computePaidPeriodEnd({
      now: d('2024-03-15T00:00:00Z'),
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      billingInterval: {},
      noticePeriod: { days: 30 },
    });
    // Empty interval can't advance; falls back to the later of the two.
    expect(got.toISOString().slice(0, 10)).toBe('2024-04-14');
  });
});
