import { describe, expect, it } from 'vitest';

import {
  formatPriceInput,
  intervalSuffix,
  parsePriceToCents,
  productSoldOut,
} from './store-format';

describe('parsePriceToCents', () => {
  it('parses whole and decimal pounds to cents', () => {
    expect(parsePriceToCents('10')).toBe(1000);
    expect(parsePriceToCents('12.50')).toBe(1250);
    expect(parsePriceToCents(' 9.99 ')).toBe(999);
    expect(parsePriceToCents('0')).toBe(0);
  });

  it('rounds to the nearest cent', () => {
    expect(parsePriceToCents('1.014')).toBe(101);
    expect(parsePriceToCents('1.006')).toBe(101);
  });

  it('rejects blanks, negatives and non-numbers', () => {
    expect(parsePriceToCents('')).toBeNull();
    expect(parsePriceToCents('   ')).toBeNull();
    expect(parsePriceToCents('-5')).toBeNull();
    expect(parsePriceToCents('abc')).toBeNull();
  });
});

describe('formatPriceInput', () => {
  it('drops a whole-number .00 but keeps real decimals', () => {
    expect(formatPriceInput(1000)).toBe('10');
    expect(formatPriceInput(1250)).toBe('12.50');
    expect(formatPriceInput(0)).toBe('0');
    expect(formatPriceInput(999)).toBe('9.99');
  });

  it('round-trips with parsePriceToCents', () => {
    for (const cents of [0, 500, 1234, 9999]) {
      expect(parsePriceToCents(formatPriceInput(cents))).toBe(cents);
    }
  });
});

describe('productSoldOut', () => {
  it('is sold out only when tracking and stock is depleted', () => {
    expect(productSoldOut({ track_inventory: true, stock_quantity: 0 })).toBe(true);
    expect(productSoldOut({ track_inventory: true, stock_quantity: 3 })).toBe(false);
  });

  it('is never sold out when inventory is untracked', () => {
    expect(productSoldOut({ track_inventory: false, stock_quantity: null })).toBe(false);
  });
});

describe('intervalSuffix', () => {
  it('maps intervals to short suffixes, defaulting to /mo', () => {
    expect(intervalSuffix('month')).toBe('/mo');
    expect(intervalSuffix('week')).toBe('/wk');
    expect(intervalSuffix('year')).toBe('/yr');
    expect(intervalSuffix('whatever')).toBe('/mo');
  });
});
