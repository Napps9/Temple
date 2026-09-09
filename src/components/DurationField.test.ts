import { describe, expect, it } from 'vitest';
import { convertExact, formatBaseDuration } from './DurationField';

// Switching a duration's unit used to round. A 90-minute class became 120
// the moment anyone opened the unit menu and chose "hrs", and the field
// then read "2 hrs" as though it always had — no warning, no undo. These
// pin the rule that replaced it: a unit that cannot say the value exactly
// is not a conversion, it is a refusal.
describe('convertExact', () => {
  it('converts when the unit divides the duration exactly', () => {
    expect(convertExact(120, 'minutes', 'hours')).toBe(2);
    expect(convertExact(48, 'hours', 'days')).toBe(2);
    expect(convertExact(14, 'days', 'weeks')).toBe(2);
    expect(convertExact(2, 'hours', 'minutes')).toBe(120);
  });

  it('refuses rather than rounding when it does not', () => {
    expect(convertExact(90, 'minutes', 'hours')).toBeNull();
    expect(convertExact(45, 'minutes', 'hours')).toBeNull();
    expect(convertExact(75, 'minutes', 'hours')).toBeNull();
    expect(convertExact(30, 'minutes', 'hours')).toBeNull();
    expect(convertExact(10, 'days', 'weeks')).toBeNull();
  });

  it('round-trips every value it accepts', () => {
    for (const mins of [30, 45, 60, 75, 90, 120, 240]) {
      const asHours = convertExact(mins, 'minutes', 'hours');
      if (asHours === null) continue;
      expect(convertExact(asHours, 'hours', 'minutes')).toBe(mins);
    }
  });

  it('is a no-op for the unit it is already in', () => {
    expect(convertExact(90, 'minutes', 'minutes')).toBe(90);
  });
});

describe('formatBaseDuration', () => {
  it('picks the largest unit that divides the value', () => {
    expect(formatBaseDuration(120, 'minutes')).toBe('2 hrs');
    expect(formatBaseDuration(90, 'minutes')).toBe('90 min');
    expect(formatBaseDuration(1440, 'minutes')).toBe('1 day');
  });

  it('renders nothing as zero', () => {
    expect(formatBaseDuration(0, 'minutes')).toBe('0');
  });
});
