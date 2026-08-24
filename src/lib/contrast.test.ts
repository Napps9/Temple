import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';
import { ACCENT, DAWN } from './theme';

describe('contrastRatio', () => {
  it('keeps the action fill readable on both grounds', () => {
    // The primary action is ink on light and paper on dark — a button
    // fill has to read on the ground behind it. 3:1 is the UI floor;
    // these clear it by an order of magnitude, which is the point of a
    // mono accent.
    expect(contrastRatio(ACCENT.light.primary, '#F7F7F8')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ACCENT.dark.primary, '#0A0B0D')).toBeGreaterThanOrEqual(3);
  });
  it('keeps the label legible on the action fill in both schemes', () => {
    expect(
      contrastRatio(ACCENT.light.onPrimary, ACCENT.light.primary),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(ACCENT.dark.onPrimary, ACCENT.dark.primary),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps ink readable on every hero-gradient stop', () => {
    // BrandGradientHero paints the vivid dawn stops in both schemes and
    // puts ink content on top — every stop has to carry it above the UI
    // floor or the hero furniture disappears.
    for (const stop of DAWN.dark) {
      expect(contrastRatio('#14161A', stop)).toBeGreaterThanOrEqual(3);
    }
  });
  it('keeps every dawn stop above the large-text floor on its ground', () => {
    // The gradient only ever paints headline-sized text, so 3:1 (the
    // large-text floor) is the bar — and it is why DAWN carries two stop
    // sets: the vivid dark-ground stops fall under it on paper.
    for (const stop of DAWN.light) {
      expect(contrastRatio(stop, '#F7F7F8')).toBeGreaterThanOrEqual(3);
    }
    for (const stop of DAWN.dark) {
      expect(contrastRatio(stop, '#0A0B0D')).toBeGreaterThanOrEqual(3);
    }
  });
  it('returns 21 for pure black on pure white', () => {
    // WCAG canonical pair.
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#E04898', '#F7F7F8')).toBeCloseTo(
      contrastRatio('#F7F7F8', '#E04898'),
      5,
    );
  });
  it('returns 1 for an invalid hex (defensive)', () => {
    expect(contrastRatio('not-a-colour', '#FFFFFF')).toBe(1);
  });
});
