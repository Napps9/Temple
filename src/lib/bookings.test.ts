import { describe, expect, it } from 'vitest';

import {
  attendanceLabel,
  describeCancelPolicy,
  groupUpcomingBookings,
  splitBookings,
  type BookingRow,
} from './bookings';

function mkRow(id: string, startsAt: string, extras: Partial<BookingRow> = {}): BookingRow {
  return {
    id,
    class_session_id: `sess-${id}`,
    starts_at: startsAt,
    duration_minutes: 60,
    class_type_name: 'CrossFit',
    class_type_color: '#2563EB',
    attended_at: null,
    no_show: false,
    promoted_from_waitlist: false,
    ...extras,
  };
}

describe('splitBookings', () => {
  const NOW = new Date('2026-06-04T10:00:00.000Z');

  it('partitions rows by starts_at vs now', () => {
    const rows = [
      mkRow('past1', '2026-06-04T08:00:00.000Z'),
      mkRow('upcoming1', '2026-06-04T18:00:00.000Z'),
      mkRow('past2', '2026-06-03T10:00:00.000Z'),
    ];
    const { upcoming, past } = splitBookings(rows, NOW);
    expect(upcoming.map((r) => r.id)).toEqual(['upcoming1']);
    expect(past.map((r) => r.id)).toEqual(['past1', 'past2']);
  });

  it('sorts upcoming ascending and past descending', () => {
    const rows = [
      mkRow('u-late', '2026-06-10T10:00:00.000Z'),
      mkRow('u-soon', '2026-06-05T10:00:00.000Z'),
      mkRow('p-recent', '2026-06-03T10:00:00.000Z'),
      mkRow('p-old', '2026-05-01T10:00:00.000Z'),
    ];
    const { upcoming, past } = splitBookings(rows, NOW);
    expect(upcoming.map((r) => r.id)).toEqual(['u-soon', 'u-late']);
    expect(past.map((r) => r.id)).toEqual(['p-recent', 'p-old']);
  });

  it('treats a row at exactly "now" as past', () => {
    const rows = [mkRow('boundary', NOW.toISOString())];
    const { upcoming, past } = splitBookings(rows, NOW);
    expect(upcoming).toHaveLength(0);
    expect(past.map((r) => r.id)).toEqual(['boundary']);
  });

  it('keeps promoted_from_waitlist rows in upcoming (they are real bookings)', () => {
    const rows = [
      mkRow('promoted', '2026-06-05T10:00:00.000Z', { promoted_from_waitlist: true }),
      mkRow('normal', '2026-06-06T10:00:00.000Z'),
    ];
    const { upcoming } = splitBookings(rows, NOW);
    expect(upcoming.map((r) => r.id)).toEqual(['promoted', 'normal']);
    expect(upcoming[0].promoted_from_waitlist).toBe(true);
  });
});

describe('groupUpcomingBookings', () => {
  // Thursday 4 June 2026. Monday-start week: 1–7 June; next week 8–14.
  const NOW = new Date(2026, 5, 4, 10, 0, 0);

  it('splits on the gym week boundary, not seven days from now', () => {
    const rows = [
      mkRow('fri', new Date(2026, 5, 5, 9, 0).toISOString()),
      mkRow('sun', new Date(2026, 5, 7, 9, 0).toISOString()),
      mkRow('mon-next', new Date(2026, 5, 8, 9, 0).toISOString()),
      mkRow('later', new Date(2026, 5, 20, 9, 0).toISOString()),
    ];
    const groups = groupUpcomingBookings(rows, 'mon', NOW);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['This week', ['fri', 'sun']],
      ['Next week', ['mon-next']],
      ['Later', ['later']],
    ]);
  });

  it('respects a Sunday-start week', () => {
    const rows = [
      mkRow('sat', new Date(2026, 5, 6, 9, 0).toISOString()),
      mkRow('sun', new Date(2026, 5, 7, 9, 0).toISOString()),
    ];
    const groups = groupUpcomingBookings(rows, 'sun', NOW);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['This week', ['sat']],
      ['Next week', ['sun']],
    ]);
  });

  it('omits empty groups', () => {
    const rows = [mkRow('later', new Date(2026, 6, 1, 9, 0).toISOString())];
    const groups = groupUpcomingBookings(rows, 'mon', NOW);
    expect(groups.map((g) => g.label)).toEqual(['Later']);
  });
});

describe('describeCancelPolicy', () => {
  const cutoff = (min: number | null): BookingRow['cancelCutoffs'] => ({
    cancel_cutoff_minutes_before: min,
    cancel_cutoff_mode: min == null ? null : 'relative',
    cancel_cutoff_time: null,
    cancel_cutoff_days_before: null,
  });

  it('names the single shared window in hours', () => {
    const rows = [
      mkRow('a', '2026-06-05T09:00:00Z', { cancelCutoffs: cutoff(120) }),
      mkRow('b', '2026-06-06T09:00:00Z', { cancelCutoffs: cutoff(120) }),
    ];
    expect(describeCancelPolicy(rows, null)).toBe(
      'Cancel up to 2 hours before a class to keep your credit.',
    );
  });

  it('falls back to the gym default when the class type has none', () => {
    const rows = [mkRow('a', '2026-06-05T09:00:00Z', { cancelCutoffs: cutoff(null) })];
    expect(describeCancelPolicy(rows, { cancel_cutoff_minutes_before: 1440 })).toBe(
      'Cancel up to 24 hours before a class to keep your credit.',
    );
  });

  it('is null when cancelling is always free', () => {
    const rows = [mkRow('a', '2026-06-05T09:00:00Z', { cancelCutoffs: cutoff(null) })];
    expect(describeCancelPolicy(rows, null)).toBeNull();
    expect(describeCancelPolicy([], null)).toBeNull();
  });

  it('generalises when cutoffs differ between class types', () => {
    const rows = [
      mkRow('a', '2026-06-05T09:00:00Z', { cancelCutoffs: cutoff(120) }),
      mkRow('b', '2026-06-06T09:00:00Z', { cancelCutoffs: cutoff(60) }),
    ];
    expect(describeCancelPolicy(rows, null)).toBe(
      "Cancel before each class's deadline to keep your credit — later forfeits it.",
    );
  });

  it('describes the day-before mode without inventing a time', () => {
    const rows = [
      mkRow('a', '2026-06-05T09:00:00Z', {
        cancelCutoffs: {
          cancel_cutoff_minutes_before: null,
          cancel_cutoff_mode: 'day_before',
          cancel_cutoff_time: '17:00',
          cancel_cutoff_days_before: 1,
        },
      }),
    ];
    expect(describeCancelPolicy(rows, null)).toBe(
      'Cancel by the day-before deadline to keep your credit.',
    );
  });
});

describe('attendanceLabel', () => {
  it('returns Attended when attended_at is set', () => {
    expect(attendanceLabel({ attended_at: '2026-06-04T11:00:00Z', no_show: false })).toBe(
      'Attended',
    );
  });
  it('returns No-show when no_show is true', () => {
    expect(attendanceLabel({ attended_at: null, no_show: true })).toBe('No-show');
  });
  it('returns Unmarked otherwise', () => {
    expect(attendanceLabel({ attended_at: null, no_show: false })).toBe('Unmarked');
  });
});
