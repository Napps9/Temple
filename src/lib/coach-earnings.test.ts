import { describe, expect, it } from 'vitest';

import {
  centsToRateInput,
  formatMoney,
  parseRateToCents,
  totalEarnings,
  type EarningsRow,
} from './coach-earnings';

function row(partial: Partial<EarningsRow>): EarningsRow {
  return {
    class_type_id: 'ct',
    class_type_name: 'CrossFit',
    class_type_color: '#FF0000',
    class_count: 0,
    rate_cents: 0,
    earnings_cents: 0,
    currency: 'GBP',
    ...partial,
  };
}

describe('totalEarnings', () => {
  it('sums earnings + classes across rows', () => {
    const t = totalEarnings([
      row({ class_count: 3, earnings_cents: 7500 }),
      row({ class_count: 2, earnings_cents: 3000 }),
    ]);
    expect(t.cents).toBe(10500);
    expect(t.classes).toBe(5);
    expect(t.currency).toBe('GBP');
  });
  it('handles empty input', () => {
    expect(totalEarnings([])).toEqual({ cents: 0, classes: 0, currency: 'GBP' });
  });
});

describe('parseRateToCents', () => {
  it('parses plain integer pounds', () => {
    expect(parseRateToCents('25')).toBe(2500);
  });
  it('parses decimals', () => {
    expect(parseRateToCents('25.50')).toBe(2550);
  });
  it('strips currency symbols', () => {
    expect(parseRateToCents('£25.50')).toBe(2550);
    expect(parseRateToCents('$30')).toBe(3000);
  });
  it('accepts comma decimal separator', () => {
    expect(parseRateToCents('25,50')).toBe(2550);
  });
  it('returns null on bad input', () => {
    expect(parseRateToCents('')).toBe(null);
    expect(parseRateToCents('abc')).toBe(null);
    expect(parseRateToCents('-5')).toBe(null);
  });
});

describe('centsToRateInput', () => {
  it('formats as a two-decimal number string', () => {
    expect(centsToRateInput(2500)).toBe('25.00');
    expect(centsToRateInput(2550)).toBe('25.50');
    expect(centsToRateInput(0)).toBe('0.00');
  });
});

describe('formatMoney', () => {
  it('renders GBP with the right symbol', () => {
    // Intl output varies a touch by node version / locale, so assert
    // on the bits we care about.
    const out = formatMoney(2550, 'GBP');
    expect(out).toMatch(/25\.50/);
    expect(out).toMatch(/£/);
  });
  it('falls back when currency code is bogus', () => {
    const out = formatMoney(2550, 'XYZ');
    expect(out).toMatch(/25\.50/);
  });
});
