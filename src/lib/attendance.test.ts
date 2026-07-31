import { describe, expect, it } from 'vitest';

import {
  bucketByClassType,
  bucketByDay,
  type AttendanceBooking,
  type AttendanceSession,
} from './attendance';

const sessions: AttendanceSession[] = [
  { id: 's-yoga-mon', class_type_id: 'ct-yoga',   starts_at: '2026-06-01T07:00:00Z' },
  { id: 's-yoga-wed', class_type_id: 'ct-yoga',   starts_at: '2026-06-03T07:00:00Z' },
  { id: 's-hiit-mon', class_type_id: 'ct-hiit',   starts_at: '2026-06-01T18:00:00Z' },
  { id: 's-open',     class_type_id: null,        starts_at: '2026-06-02T12:00:00Z' },
];

const bookings: AttendanceBooking[] = [
  { class_session_id: 's-yoga-mon', attended_at: '2026-06-01T07:05:00Z', no_show: false },
  { class_session_id: 's-yoga-mon', attended_at: null, no_show: true },
  { class_session_id: 's-yoga-mon', attended_at: null, no_show: false },
  { class_session_id: 's-yoga-wed', attended_at: '2026-06-03T07:01:00Z', no_show: false },
  { class_session_id: 's-hiit-mon', attended_at: '2026-06-01T18:00:00Z', no_show: false },
  { class_session_id: 's-open',     attended_at: null, no_show: true },
  { class_session_id: 'unknown',    attended_at: null, no_show: false }, // skipped
];

describe('attendance helpers', () => {
  describe('bucketByClassType', () => {
    it('groups bookings by class_type and counts attended/no_show/unmarked', () => {
      const result = bucketByClassType(bookings, sessions);
      const yoga = result.find(r => r.class_type_id === 'ct-yoga');
      const hiit = result.find(r => r.class_type_id === 'ct-hiit');
      const open = result.find(r => r.class_type_id === null);

      expect(yoga).toEqual({ class_type_id: 'ct-yoga', attended: 2, no_show: 1, unmarked: 1 });
      expect(hiit).toEqual({ class_type_id: 'ct-hiit', attended: 1, no_show: 0, unmarked: 0 });
      expect(open).toEqual({ class_type_id: null, attended: 0, no_show: 1, unmarked: 0 });
    });

    it('sums to the count of bookings with a resolved session', () => {
      const result = bucketByClassType(bookings, sessions);
      const total = result.reduce(
        (acc, b) => acc + b.attended + b.no_show + b.unmarked,
        0,
      );
      // 6 valid bookings (1 dropped because session unknown).
      expect(total).toBe(6);
    });
  });

  describe('bucketByDay', () => {
    it('counts attended bookings per day, sorted ascending', () => {
      const result = bucketByDay(
        bookings,
        sessions,
        { start: '2026-06-01', end: '2026-06-30' },
        'Europe/London',
      );
      expect(result).toEqual([
        { day: '2026-06-01', attended: 2 }, // yoga-mon + hiit-mon
        { day: '2026-06-03', attended: 1 }, // yoga-wed
      ]);
    });

    it('excludes days outside the range', () => {
      const result = bucketByDay(
        bookings,
        sessions,
        { start: '2026-06-02', end: '2026-06-02' },
        'Europe/London',
      );
      expect(result).toEqual([]);
    });

    it('excludes no-shows and unmarked', () => {
      const onlyNoShow = bucketByDay(
        [{ class_session_id: 's-yoga-mon', attended_at: null, no_show: true }],
        sessions,
        { start: '2026-06-01', end: '2026-06-30' },
        'Europe/London',
      );
      expect(onlyNoShow).toEqual([]);
    });
  });
});

// The bug the timezone argument exists to stop: a 6am class in Sydney
// starts at 20:00 UTC the day before, so slicing the stored timestamp
// filed it under yesterday — and at a week boundary, under last week.
describe('which day a class counts as', () => {
  const sessions = [
    { id: 's-dawn', class_type_id: 'ct-1', starts_at: '2026-08-03T20:00:00Z' },
  ];
  const bookings = [
    { class_session_id: 's-dawn', attended_at: '2026-08-04T06:05:00Z', no_show: false },
  ];

  it('files a Sydney dawn class under the gym’s day, not UTC’s', () => {
    expect(
      bucketByDay(bookings, sessions, { start: '2026-08-01', end: '2026-08-31' }, 'Australia/Sydney'),
    ).toEqual([{ day: '2026-08-04', attended: 1 }]);
    expect(
      bucketByDay(bookings, sessions, { start: '2026-08-01', end: '2026-08-31' }, 'UTC'),
    ).toEqual([{ day: '2026-08-03', attended: 1 }]);
  });

  it('so a range that starts on the 4th still contains it', () => {
    expect(
      bucketByDay(bookings, sessions, { start: '2026-08-04', end: '2026-08-10' }, 'Australia/Sydney'),
    ).toEqual([{ day: '2026-08-04', attended: 1 }]);
  });
});
