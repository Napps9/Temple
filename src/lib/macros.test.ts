import { describe, expect, it } from 'vitest';

import { kcalFromMacros, macroError, macroSplit } from './macros';

describe('kcalFromMacros', () => {
  it('is 4/4/9', () => {
    expect(kcalFromMacros({ protein_g: 180, carbs_g: 220, fat_g: 70 })).toBe(2230);
  });

  it('is zero for an empty prescription', () => {
    expect(kcalFromMacros({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toBe(0);
  });
});

describe('macroSplit', () => {
  it('shares add up to a hundred', () => {
    const s = macroSplit({ protein_g: 180, carbs_g: 220, fat_g: 70 });
    expect(s.protein + s.carbs + s.fat).toBeCloseTo(100, 6);
  });

  // 0/0/0 is a legitimate saved state, and dividing by it must not put
  // NaN% on a member's card.
  it('does not divide by zero', () => {
    expect(macroSplit({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('macroError', () => {
  it('accepts three whole numbers', () => {
    expect(macroError({ protein: '180', carbs: '220', fat: '70' })).toBeNull();
  });

  it('names the field that is empty', () => {
    expect(macroError({ protein: '180', carbs: '', fat: '70' })).toBe(
      'Carbs needs a number',
    );
  });

  it('refuses decimals — grams are whole', () => {
    expect(macroError({ protein: '180.5', carbs: '220', fat: '70' })).toBe(
      'Protein must be a whole number of grams',
    );
  });

  it('refuses a figure the server would reject anyway', () => {
    expect(macroError({ protein: '180', carbs: '220', fat: '9000' })).toBe(
      'Fat looks too high',
    );
  });
});
