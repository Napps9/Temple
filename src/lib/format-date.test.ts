import { describe, expect, it } from 'vitest';

import { formatDate } from './format-date';

describe('formatDate', () => {
  it('formats an ISO date as DD/MM/YYYY', () => {
    expect(formatDate('2026-03-03')).toBe('03/03/2026');
    expect(formatDate('1991-09-06')).toBe('06/09/1991');
  });

  it('takes the date part of an ISO timestamp without a timezone shift', () => {
    expect(formatDate('2025-12-27T23:30:00.000Z')).toBe('27/12/2025');
    expect(formatDate('2025-12-27T00:15:00+00:00')).toBe('27/12/2025');
  });

  it('formats a Date', () => {
    expect(formatDate(new Date(2026, 0, 9))).toBe('09/01/2026');
  });

  it('returns empty string for nullish / empty input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });

  it('returns the raw string when it cannot be parsed', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });
});
