import { describe, expect, it } from 'vitest';

import { attendanceLabel, splitBookings, type BookingRow } from './bookings';

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
