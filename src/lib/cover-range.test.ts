import { describe, expect, it } from 'vitest';

import { coverRangeWindow, validateCoverRange } from './cover-range';

describe('coverRangeWindow', () => {
  it('runs from local midnight to midnight the day after the end date', () => {
    expect(coverRangeWindow('2026-12-22', '2027-01-03', 'UTC')).toEqual({
      startIso: '2026-12-22T00:00:00.000Z',
      endIso: '2027-01-04T00:00:00.000Z',
    });
  });

  it('handles a single-day range', () => {
    expect(coverRangeWindow('2026-12-25', '2026-12-25', 'UTC')).toEqual({
      startIso: '2026-12-25T00:00:00.000Z',
      endIso: '2026-12-26T00:00:00.000Z',
    });
  });

  it('rolls the end date over a month boundary', () => {
    expect(coverRangeWindow('2026-01-28', '2026-01-31', 'UTC')?.endIso).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('shifts both edges for a summer BST window', () => {
    // Europe/London is UTC+1 in July, so local midnight is 23:00 UTC the
    // day before.
    expect(coverRangeWindow('2026-07-06', '2026-07-10', 'Europe/London')).toEqual(
      {
        startIso: '2026-07-05T23:00:00.000Z',
        endIso: '2026-07-10T23:00:00.000Z',
      },
    );
  });

  it('shifts only the start edge across the autumn DST change', () => {
    // BST (UTC+1) until 25 Oct 2026, GMT (UTC+0) after.
    expect(coverRangeWindow('2026-10-24', '2026-10-28', 'Europe/London')).toEqual(
      {
        startIso: '2026-10-23T23:00:00.000Z',
        endIso: '2026-10-29T00:00:00.000Z',
      },
    );
  });

  it('handles a positive-offset zone', () => {
    // Australia/Brisbane is UTC+10 year round.
    expect(
      coverRangeWindow('2026-12-22', '2026-12-23', 'Australia/Brisbane'),
    ).toEqual({
      startIso: '2026-12-21T14:00:00.000Z',
      endIso: '2026-12-23T14:00:00.000Z',
    });
  });

  it('rejects malformed and impossible dates', () => {
    expect(coverRangeWindow('22/12/2026', '2027-01-03', 'UTC')).toBeNull();
    expect(coverRangeWindow('2026-02-30', '2026-03-05', 'UTC')).toBeNull();
    expect(coverRangeWindow('', '2027-01-03', 'UTC')).toBeNull();
  });
});

describe('validateCoverRange', () => {
  const now = new Date('2026-07-27T09:00:00Z');

  it('accepts a future range', () => {
    expect(
      validateCoverRange('2026-12-22', '2027-01-03', 'UTC', now),
    ).toBeNull();
  });

  it('rejects an empty start or end', () => {
    expect(validateCoverRange('', '2027-01-03', 'UTC', now)).toBe(
      'Pick a start date',
    );
    expect(validateCoverRange('2026-12-22', '', 'UTC', now)).toBe(
      'Pick an end date',
    );
  });

  it('rejects an end before the start', () => {
    expect(validateCoverRange('2027-01-03', '2026-12-22', 'UTC', now)).toBe(
      'The end date is before the start date',
    );
  });

  it('rejects a range wholly in the past', () => {
    expect(validateCoverRange('2026-07-01', '2026-07-10', 'UTC', now)).toBe(
      'That date range is in the past',
    );
  });

  it('accepts a range ending today, since today has hours left', () => {
    expect(validateCoverRange('2026-07-20', '2026-07-27', 'UTC', now)).toBeNull();
  });
});
