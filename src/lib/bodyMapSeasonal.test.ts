import { describe, expect, it } from 'vitest';

import { getSeasonalSkin } from './bodyMapSeasonal';

function on(month: number, day: number, year = 2026): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe('getSeasonalSkin', () => {
  it('returns null on a non-themed day', () => {
    expect(getSeasonalSkin(on(7, 14))).toBeNull();
    expect(getSeasonalSkin(on(9, 4))).toBeNull();
  });

  it('detects pride all of June', () => {
    expect(getSeasonalSkin(on(6, 1))).toBe('pride');
    expect(getSeasonalSkin(on(6, 15))).toBe('pride');
    expect(getSeasonalSkin(on(6, 30))).toBe('pride');
    expect(getSeasonalSkin(on(7, 1))).toBeNull();
    expect(getSeasonalSkin(on(5, 31))).toBeNull();
  });

  it('detects the Halloween window', () => {
    expect(getSeasonalSkin(on(10, 27))).toBeNull();
    expect(getSeasonalSkin(on(10, 28))).toBe('halloween');
    expect(getSeasonalSkin(on(10, 31))).toBe('halloween');
    expect(getSeasonalSkin(on(11, 1))).toBe('halloween');
    expect(getSeasonalSkin(on(11, 2))).toBeNull();
  });

  it('detects the Christmas window', () => {
    expect(getSeasonalSkin(on(12, 19))).toBeNull();
    expect(getSeasonalSkin(on(12, 20))).toBe('christmas');
    expect(getSeasonalSkin(on(12, 25))).toBe('christmas');
    expect(getSeasonalSkin(on(12, 26))).toBe('christmas');
    expect(getSeasonalSkin(on(12, 27))).toBeNull();
  });

  it('detects New Year across the year boundary', () => {
    expect(getSeasonalSkin(on(12, 31))).toBe('newyear');
    expect(getSeasonalSkin(on(1, 1))).toBe('newyear');
    expect(getSeasonalSkin(on(1, 2))).toBe('newyear');
    expect(getSeasonalSkin(on(1, 3))).toBeNull();
  });

  it('detects Valentine and St Patrick narrow windows', () => {
    expect(getSeasonalSkin(on(2, 14))).toBe('valentine');
    expect(getSeasonalSkin(on(2, 12))).toBeNull();
    expect(getSeasonalSkin(on(2, 16))).toBeNull();
    expect(getSeasonalSkin(on(3, 17))).toBe('stpatricks');
    expect(getSeasonalSkin(on(3, 19))).toBeNull();
  });
});
