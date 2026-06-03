import { describe, expect, it } from 'vitest';

import { computeResumedPaidPeriodEnd, pauseDurationMs } from './pause-math';

function d(iso: string): Date {
  return new Date(iso);
}

describe('pauseDurationMs', () => {
  it('returns positive duration in ms', () => {
    expect(
      pauseDurationMs({
        pauseStartedAt: d('2024-03-01T00:00:00Z'),
        resumeAt: d('2024-03-08T00:00:00Z'),
      }),
    ).toBe(7 * 24 * 3600 * 1000);
  });

  it('clamps negative to zero', () => {
    expect(
      pauseDurationMs({
        pauseStartedAt: d('2024-03-08T00:00:00Z'),
        resumeAt: d('2024-03-01T00:00:00Z'),
      }),
    ).toBe(0);
  });

  it('returns zero for instantaneous resume', () => {
    const t = d('2024-03-01T00:00:00Z');
    expect(pauseDurationMs({ pauseStartedAt: t, resumeAt: t })).toBe(0);
  });
});

describe('computeResumedPaidPeriodEnd', () => {
  it('shifts paidPeriodEnd by pause duration', () => {
    const got = computeResumedPaidPeriodEnd({
      paidPeriodEnd: d('2024-04-01T00:00:00Z'),
      pauseStartedAt: d('2024-03-01T00:00:00Z'),
      resumeAt: d('2024-03-15T00:00:00Z'),
    });
    expect(got?.toISOString()).toBe('2024-04-15T00:00:00.000Z');
  });

  it('preserves time-of-day on the shift', () => {
    const got = computeResumedPaidPeriodEnd({
      paidPeriodEnd: d('2024-04-01T18:00:00Z'),
      pauseStartedAt: d('2024-03-10T09:00:00Z'),
      resumeAt: d('2024-03-12T21:00:00Z'),
    });
    // 2 days 12 hours of pause shifts April 1 18:00 to April 4 06:00.
    expect(got?.toISOString()).toBe('2024-04-04T06:00:00.000Z');
  });

  it('returns null when paidPeriodEnd is null', () => {
    expect(
      computeResumedPaidPeriodEnd({
        paidPeriodEnd: null,
        pauseStartedAt: d('2024-03-01T00:00:00Z'),
        resumeAt: d('2024-03-15T00:00:00Z'),
      }),
    ).toBeNull();
  });

  it('returns paidPeriodEnd unchanged for zero-duration pause', () => {
    const end = d('2024-04-01T00:00:00Z');
    const got = computeResumedPaidPeriodEnd({
      paidPeriodEnd: end,
      pauseStartedAt: d('2024-03-01T00:00:00Z'),
      resumeAt: d('2024-03-01T00:00:00Z'),
    });
    expect(got?.toISOString()).toBe(end.toISOString());
  });
});
