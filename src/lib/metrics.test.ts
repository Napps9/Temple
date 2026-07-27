import { describe, expect, it } from 'vitest';

import {
  dayBefore,
  mirrorRange,
  monthLabel,
  monthRange,
  pctDelta,
  pickPrimaryCurrency,
  ppDelta,
  previousMonthRange,
} from './metrics';

describe('monthRange / previousMonthRange', () => {
  it('covers the whole calendar month', () => {
    expect(monthRange(new Date('2026-07-15T09:00:00Z'))).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
  });

  it('rolls back over the new year', () => {
    expect(previousMonthRange(new Date('2026-01-09T09:00:00Z'))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('handles a short previous month from a long one', () => {
    expect(previousMonthRange(new Date('2026-03-31T09:00:00Z'))).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('gets February right in a leap year', () => {
    expect(monthRange(new Date('2028-02-10T09:00:00Z'))).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });

  it('is stable on the first and last instant of a month', () => {
    expect(monthRange(new Date('2026-07-01T00:00:00Z')).start).toBe('2026-07-01');
    expect(monthRange(new Date('2026-07-31T23:59:59Z')).end).toBe('2026-07-31');
  });
});

describe('monthLabel', () => {
  it('names the month without sliding on the viewer offset', () => {
    expect(monthLabel('2026-07-01')).toBe('July 2026');
    expect(monthLabel('2026-01-01')).toBe('January 2026');
    expect(monthLabel('2025-12-01')).toBe('December 2025');
  });
});

describe('mirrorRange', () => {
  it('mirrors by length, not by calendar month', () => {
    // 31 days of July mirrored back is 31 days, landing in June — this is
    // why "last month" cannot be built out of mirrorRange.
    expect(mirrorRange({ start: '2026-07-01', end: '2026-07-31' })).toEqual({
      start: '2026-05-31',
      end: '2026-06-30',
    });
  });

  it('mirrors a single day to the day before', () => {
    expect(mirrorRange({ start: '2026-07-15', end: '2026-07-15' })).toEqual({
      start: '2026-07-14',
      end: '2026-07-14',
    });
  });
});

describe('dayBefore', () => {
  it('steps back over a month boundary', () => {
    expect(dayBefore('2026-07-01')).toBe('2026-06-30');
  });
});

describe('pctDelta', () => {
  it('calls a rise from nothing "new" rather than infinite', () => {
    expect(pctDelta(500, 0)).toEqual({ direction: 'up', label: 'new' });
  });

  it('calls nothing to nothing "no change"', () => {
    expect(pctDelta(0, 0)).toEqual({ direction: 'flat', label: 'no change' });
  });

  it('signs and rounds a real move', () => {
    expect(pctDelta(150, 100)).toEqual({ direction: 'up', label: '+50.0%' });
    expect(pctDelta(75, 100)).toEqual({ direction: 'down', label: '-25.0%' });
  });
});

describe('ppDelta', () => {
  it('reports percentage points, not a ratio', () => {
    expect(ppDelta(62.5, 60)).toEqual({ direction: 'up', label: '+2.5 pp' });
    expect(ppDelta(60, 60)).toEqual({ direction: 'flat', label: '0 pp' });
  });
});

describe('pickPrimaryCurrency', () => {
  it('falls back to the gym currency when nothing has been charged', () => {
    expect(pickPrimaryCurrency([], 'EUR')).toEqual({
      currency: 'EUR',
      gross_cents: 0,
      charge_count: 0,
    });
  });

  it('picks the busiest currency, not the biggest total', () => {
    expect(
      pickPrimaryCurrency(
        [
          { currency: 'USD', gross_cents: 900000, charge_count: 1 },
          { currency: 'GBP', gross_cents: 5000, charge_count: 40 },
        ],
        'EUR',
      ).currency,
    ).toBe('GBP');
  });
});
