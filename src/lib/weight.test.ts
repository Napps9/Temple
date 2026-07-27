import { describe, expect, it } from 'vitest';

import { displayToKg, formatWeight, kgToDisplay } from './weight';

describe('weight conversion', () => {
  it('leaves kilograms alone', () => {
    expect(kgToDisplay(100, 'kg')).toBe(100);
    expect(displayToKg(100, 'kg')).toBe(100);
  });

  it('converts to pounds and back without drift', () => {
    const kg = 142.5;
    expect(displayToKg(kgToDisplay(kg, 'lb'), 'lb')).toBeCloseTo(kg, 6);
  });

  // The bug this exists for: 315 lb is 142.9 kg, so it does NOT outrank a
  // 200 kg lift. Comparing the raw numbers said otherwise.
  it('puts a 315 lb import below a 200 kg lift', () => {
    expect(displayToKg(315, 'lb')).toBeLessThan(200);
  });
});

describe('formatWeight', () => {
  it('renders a kilogram value in a kilogram gym', () => {
    expect(formatWeight(100, 'kg')).toBe('100 kg');
  });

  it('renders the same stored value in pounds for a pounds gym', () => {
    expect(formatWeight(100, 'lb')).toBe('220.5 lb');
  });

  it('drops the decimal when the number is whole', () => {
    expect(formatWeight(60, 'kg')).toBe('60 kg');
  });

  it('keeps one decimal, because a converted number is not exact', () => {
    expect(formatWeight(142.5, 'kg')).toBe('142.5 kg');
  });

  it('has nothing to say about a missing weight', () => {
    expect(formatWeight(null, 'kg')).toBe('');
    expect(formatWeight(undefined, 'lb')).toBe('');
  });
});
