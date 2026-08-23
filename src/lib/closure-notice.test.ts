import { describe, expect, it } from 'vitest';

import { closureNoticeCopy, closureRangePhrase } from './closure-notice';

describe('closureRangePhrase', () => {
  it('names a single day with its weekday', () => {
    expect(closureRangePhrase('2026-08-31', '2026-08-31')).toBe(
      'Monday 31 August',
    );
  });

  it('collapses a same-month range', () => {
    expect(closureRangePhrase('2026-12-24', '2026-12-28')).toBe(
      '24 to 28 December',
    );
  });

  it('names both months across a boundary', () => {
    expect(closureRangePhrase('2026-12-28', '2027-01-02')).toBe(
      '28 December to 2 January',
    );
  });
});

describe('closureNoticeCopy', () => {
  it('folds the reason into the body, lowercased', () => {
    const c = closureNoticeCopy('2026-08-31', '2026-08-31', 'Bank holiday');
    expect(c.title).toBe('Closed Monday 31 August');
    expect(c.body).toContain('— bank holiday.');
    expect(c.body).toContain('listed below');
  });

  it('reads cleanly with no reason', () => {
    const c = closureNoticeCopy('2026-12-24', '2026-12-28', '  ');
    expect(c.title).toBe('Closed 24 to 28 December');
    expect(c.body).toBe(
      'The gym is closed 24 to 28 December. Any classes you had booked on these dates are cancelled, and what changed for you is listed below.',
    );
  });
});
