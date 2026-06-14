import { describe, expect, it } from 'vitest';

import { dayBeforeCutoffEpoch, wallTimeToEpoch } from './zoned-time';

describe('wallTimeToEpoch', () => {
  it('treats a UTC wall time as the same instant', () => {
    expect(wallTimeToEpoch(2026, 6, 15, 21, 0, 'UTC')).toBe(
      Date.UTC(2026, 5, 15, 21, 0),
    );
  });

  it('applies a negative offset for a western zone (EDT = UTC-4)', () => {
    // 21:00 on 2026-06-15 in New York (summer, UTC-4) = 01:00 UTC next day.
    expect(wallTimeToEpoch(2026, 6, 15, 21, 0, 'America/New_York')).toBe(
      Date.UTC(2026, 5, 16, 1, 0),
    );
  });
});

describe('dayBeforeCutoffEpoch', () => {
  it('computes "21:00, 1 day before" in UTC', () => {
    expect(
      dayBeforeCutoffEpoch('2026-06-16T10:00:00Z', 'UTC', 1, '21:00'),
    ).toBe(Date.UTC(2026, 5, 15, 21, 0));
  });

  it('anchors to the class local date in a western zone', () => {
    // Class 2026-06-16T10:00Z is 06:00 EDT (date 06-16); 1 day before at
    // 21:00 EDT = 2026-06-16T01:00Z.
    expect(
      dayBeforeCutoffEpoch(
        '2026-06-16T10:00:00Z',
        'America/New_York',
        1,
        '21:00',
      ),
    ).toBe(Date.UTC(2026, 5, 16, 1, 0));
  });

  it('accepts HH:MM:SS times from Postgres', () => {
    expect(
      dayBeforeCutoffEpoch('2026-06-16T10:00:00Z', 'UTC', 2, '09:30:00'),
    ).toBe(Date.UTC(2026, 5, 14, 9, 30));
  });
});
