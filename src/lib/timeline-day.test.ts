import { describe, expect, it } from 'vitest';

import {
  clampDayKey,
  classifyDay,
  compareDayKeys,
  dayKeyOf,
  dayStart,
  nextDayStart,
  pagerBounds,
  shiftDayKey,
} from './timeline-day';

describe('day keys', () => {
  it('round-trips a date through its key', () => {
    const d = new Date(2026, 7, 3, 14, 30);
    expect(dayKeyOf(d)).toBe('2026-08-03');
    expect(dayKeyOf(dayStart('2026-08-03'))).toBe('2026-08-03');
  });

  it('starts a day at local midnight and ends before the next one', () => {
    const start = dayStart('2026-08-03');
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    const next = nextDayStart('2026-08-03');
    expect(dayKeyOf(next)).toBe('2026-08-04');
    expect(next.getHours()).toBe(0);
  });

  it('rolls months and years without arithmetic on millis', () => {
    expect(shiftDayKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29');
  });

  // DST: the clocks move inside these windows in Europe/London and most
  // of Europe/US. Day boundaries must not shift with them.
  it('keeps day boundaries at midnight across DST transitions', () => {
    expect(dayKeyOf(nextDayStart('2026-03-29'))).toBe('2026-03-30');
    expect(nextDayStart('2026-03-29').getHours()).toBe(0);
    expect(dayKeyOf(nextDayStart('2026-10-25'))).toBe('2026-10-26');
    expect(nextDayStart('2026-10-25').getHours()).toBe(0);
    expect(shiftDayKey('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('orders keys lexicographically, which is date order', () => {
    expect(compareDayKeys('2026-08-03', '2026-08-04')).toBe(-1);
    expect(compareDayKeys('2026-08-04', '2026-08-03')).toBe(1);
    expect(compareDayKeys('2026-08-03', '2026-08-03')).toBe(0);
  });
});

describe('clamping and bounds', () => {
  it('clamps to the reachable range', () => {
    expect(clampDayKey('2025-01-01', '2025-06-01', '2026-01-01')).toBe('2025-06-01');
    expect(clampDayKey('2027-01-01', '2025-06-01', '2026-01-01')).toBe('2026-01-01');
    expect(clampDayKey('2025-09-15', '2025-06-01', '2026-01-01')).toBe('2025-09-15');
  });

  it('floors at the day the gym row was born, whatever the time of day', () => {
    const now = new Date(2026, 7, 3);
    const b = pagerBounds('2025-11-20T17:45:00Z', 12, now);
    // The gym was created mid-afternoon; its whole first day is reachable.
    expect(b.floor.startsWith('2025-11-2')).toBe(true);
    expect(b.ceiling).toBe('2026-10-26'); // 12 weeks = 84 days ahead
  });

  it('falls back to twelve weeks when the horizon is missing or nonsense', () => {
    const now = new Date(2026, 7, 3);
    expect(pagerBounds('2025-01-01', NaN, now).ceiling).toBe('2026-10-26');
    expect(pagerBounds('2025-01-01', 0, now).ceiling).toBe('2026-10-26');
    expect(pagerBounds('2025-01-01', 4, now).ceiling).toBe('2026-08-31');
  });
});

describe('classifyDay', () => {
  const now = new Date(2026, 7, 3, 9, 0);

  it('knows today from the record and the future', () => {
    expect(classifyDay('2026-08-03', now)).toEqual({
      key: '2026-08-03',
      isToday: true,
      isPast: false,
      isFuture: false,
    });
    expect(classifyDay('2026-08-02', now).isPast).toBe(true);
    expect(classifyDay('2026-08-04', now).isFuture).toBe(true);
  });
});
