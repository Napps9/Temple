import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';

describe('contrastRatio', () => {
  it("clears the UI floor for Temple's accent on both grounds", () => {
    // The accent is a button fill carrying a white label, so it has to
    // read on the ground behind it in both schemes. 3:1 is the UI floor.
    expect(contrastRatio('#C2410C', '#F7F7F8')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#F0783C', '#0A0B0D')).toBeGreaterThanOrEqual(3);
  });
  it("keeps a white label legible on the light accent", () => {
    expect(contrastRatio('#C2410C', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
  it('returns 21 for pure black on pure white', () => {
    // WCAG canonical pair.
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#C2410C', '#F7F7F8')).toBeCloseTo(
      contrastRatio('#F7F7F8', '#C2410C'),
      5,
    );
  });
  it('returns 1 for an invalid hex (defensive)', () => {
    expect(contrastRatio('not-a-colour', '#FFFFFF')).toBe(1);
  });
});
