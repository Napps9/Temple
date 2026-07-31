import { describe, expect, it } from 'vitest';

import {
  parseTypedWallTime,
  parseWallTime,
  sendAtEpoch,
  sendAtLabel,
  untilLabel,
} from './send-time';

describe('reading a send time', () => {
  it('takes a date and a 24-hour clock', () => {
    expect(parseWallTime('2026-08-04', '09:00')).toEqual({
      y: 2026,
      mo: 8,
      d: 4,
      h: 9,
      mi: 0,
    });
    expect(parseWallTime('2026-08-04', '9:30')).toEqual({
      y: 2026,
      mo: 8,
      d: 4,
      h: 9,
      mi: 30,
    });
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    expect(parseWallTime('2026-04-31', '09:00')).toBeNull();
    expect(parseWallTime('2026-02-30', '09:00')).toBeNull();
    expect(parseWallTime('2026-02-28', '09:00')).not.toBeNull();
  });

  it('refuses the shapes a model might send instead', () => {
    expect(parseWallTime('4 August 2026', '09:00')).toBeNull();
    expect(parseWallTime('2026-08-04', '9am')).toBeNull();
    expect(parseWallTime('2026-08-04', '25:00')).toBeNull();
    expect(parseWallTime('2026-08-04', '09:61')).toBeNull();
    expect(parseWallTime(null, '09:00')).toBeNull();
    expect(parseWallTime('2026-08-04', undefined)).toBeNull();
  });

  it('reads the editor field the same way, typed or pasted', () => {
    expect(parseTypedWallTime('2026-08-04 18:30')).toEqual(
      parseWallTime('2026-08-04', '18:30'),
    );
    expect(parseTypedWallTime('2026-08-04T18:30')).toEqual(
      parseWallTime('2026-08-04', '18:30'),
    );
    expect(parseTypedWallTime('next Tuesday')).toBeNull();
  });
});

// The bug this exists to stop: a coach on holiday scheduling "Monday at
// 9" and the London gym's members getting it at 7.
describe('the hour is the gym’s, not the device’s', () => {
  const w = { y: 2026, mo: 8, d: 4, h: 9, mi: 0 };
  const now = Date.UTC(2026, 6, 1);

  it('resolves the wall time in the gym’s zone', () => {
    // 4 August is BST, so 09:00 London is 08:00 UTC.
    expect(sendAtEpoch(w, 'Europe/London', now)).toBe(
      Date.UTC(2026, 7, 4, 8, 0),
    );
    // Athens is UTC+3 in August, so the same wall time is 06:00 UTC.
    expect(sendAtEpoch(w, 'Europe/Athens', now)).toBe(
      Date.UTC(2026, 7, 4, 6, 0),
    );
    // New York is UTC-4 in August.
    expect(sendAtEpoch(w, 'America/New_York', now)).toBe(
      Date.UTC(2026, 7, 4, 13, 0),
    );
  });

  it('holds through the winter, when London is UTC', () => {
    const jan = { y: 2027, mo: 1, d: 4, h: 9, mi: 0 };
    expect(sendAtEpoch(jan, 'Europe/London', now)).toBe(
      Date.UTC(2027, 0, 4, 9, 0),
    );
  });

  it('refuses a time already gone, and one absurdly far ahead', () => {
    expect(sendAtEpoch(w, 'Europe/London', Date.UTC(2026, 8, 1))).toBeNull();
    expect(
      sendAtEpoch({ ...w, y: 2030 }, 'Europe/London', now),
    ).toBeNull();
  });

  it('labels it back in the same zone it was read in', () => {
    const at = sendAtEpoch(w, 'Europe/London', now)!;
    expect(sendAtLabel(at, 'Europe/London')).toBe('Tuesday 4 August at 09:00');
    // The same instant, named where it is not nine o'clock.
    expect(sendAtLabel(at, 'Europe/Athens')).toBe('Tuesday 4 August at 11:00');
  });
});

describe('how far away it is', () => {
  const now = Date.UTC(2026, 7, 1, 12, 0);
  it('reads in the unit that matches the distance', () => {
    expect(untilLabel(now + 40 * 60_000, now)).toBe('in 40 minutes');
    expect(untilLabel(now + 60 * 60_000, now)).toBe('in 1 hour');
    expect(untilLabel(now + 5 * 3600_000, now)).toBe('in 5 hours');
    expect(untilLabel(now + 3 * 86_400_000, now)).toBe('in 3 days');
    expect(untilLabel(now + 86_400_000, now)).toBe('in 24 hours');
  });
});
