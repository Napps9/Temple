import { describe, expect, it } from 'vitest';

import {
  GYM_HOURS,
  RECURRENCE_DEFS,
  expandOccurrences,
  isoDateOffset,
  localToUtc,
} from './timetable';

describe('localToUtc', () => {
  it('handles Europe/London across the DST boundary', () => {
    // GMT in January: local 06:00 IS 06:00Z.
    expect(localToUtc('2026-01-15', '06:00', 'Europe/London')).toBe('2026-01-15T06:00:00.000Z');
    // BST in July: local 06:00 is 05:00Z.
    expect(localToUtc('2026-07-15', '06:00', 'Europe/London')).toBe('2026-07-15T05:00:00.000Z');
  });

  it('handles a zone with no DST', () => {
    expect(localToUtc('2026-07-15', '12:00', 'UTC')).toBe('2026-07-15T12:00:00.000Z');
  });
});

describe('expandOccurrences', () => {
  const def = RECURRENCE_DEFS[0]; // CrossFit, Mon-Fri, two times

  it('emits every weekday slot exactly once over one week', () => {
    // 2026-06-01 is a Monday; through Sunday the 7th → 5 weekdays × 2 times.
    const occs = expandOccurrences(def, '2026-06-01', '2026-06-07', 'Europe/London');
    expect(occs).toHaveLength(10);
    const keys = occs.map((o) => `${o.dateISO} ${o.time}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respects the date range bounds inclusively', () => {
    const single = expandOccurrences(def, '2026-06-01', '2026-06-01', 'Europe/London');
    expect(single).toHaveLength(2);
    expect(single.every((o) => o.dateISO === '2026-06-01')).toBe(true);
  });
});

describe('timetable definitions', () => {
  it('uses 0=Sunday day numbering within range and never schedules Sunday', () => {
    for (const def of RECURRENCE_DEFS) {
      for (const d of def.daysOfWeek) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
    }
    // gym_hours: no Sunday (0) row — closed by absence.
    expect(GYM_HOURS.some(([day]) => day === 0)).toBe(false);
  });
});

describe('isoDateOffset', () => {
  it('offsets across month boundaries', () => {
    expect(isoDateOffset('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoDateOffset('2026-12-31', 1)).toBe('2027-01-01');
  });
});
