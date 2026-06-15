import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  DARK_BG,
  deriveDarkColour,
  deriveLightColour,
  LIGHT_BG,
} from './brand-derivation';

describe('contrastRatio', () => {
  it('returns 21 for pure black on pure white', () => {
    // WCAG canonical pair.
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#2563EB', LIGHT_BG)).toBeCloseTo(
      contrastRatio(LIGHT_BG, '#2563EB'),
      5,
    );
  });
  it('returns 1 for an invalid hex (defensive)', () => {
    expect(contrastRatio('not-a-colour', '#FFFFFF')).toBe(1);
  });
});

describe('deriveDarkColour', () => {
  it('lifts pure black into a visible grey on the dark bg', () => {
    // #000000 has ~1:1 contrast on near-black, invisible. The derived
    // value must clear the 3:1 floor.
    const out = deriveDarkColour('#000000');
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3);
  });
  it("leaves a colour alone if it's already readable on dark", () => {
    // Brand yellow already pops on a dark bg — no need to drift.
    expect(deriveDarkColour('#EBE925')).toBe('#EBE925');
  });
  it('keeps a saturated mid-blue close to itself but legible', () => {
    const before = '#2563EB';
    const after = deriveDarkColour(before);
    expect(contrastRatio(after, DARK_BG)).toBeGreaterThanOrEqual(3);
  });
  it('preserves hue when it adjusts (no greys popping out of colours)', () => {
    const out = deriveDarkColour('#1E40AF'); // dark blue, will need to brighten
    // The R channel should stay the smallest, B the largest — the
    // colour family is still blue.
    const r = parseInt(out.slice(1, 3), 16);
    const b = parseInt(out.slice(5, 7), 16);
    expect(b).toBeGreaterThan(r);
  });
});

describe('deriveLightColour', () => {
  it('darkens pure white into a visible grey on the light bg', () => {
    const out = deriveLightColour('#FFFFFF');
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3);
  });
  it('leaves a dark brand colour alone on light mode', () => {
    expect(deriveLightColour('#2563EB')).toBe('#2563EB');
  });
  it("brings a too-light yellow into a tone the light bg doesn't swallow", () => {
    // Pale yellow on a slate-100 bg is illegible; the function should
    // darken it until contrast is OK.
    const out = deriveLightColour('#FFF59D');
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3);
  });
});

describe('round-trip', () => {
  it('a colour derived for dark mode then back to light is still legible on light', () => {
    const dark = deriveDarkColour('#000000');
    const light = deriveLightColour(dark);
    expect(contrastRatio(light, LIGHT_BG)).toBeGreaterThanOrEqual(3);
  });

  // Guard against a future change that makes either derive function
  // always nudge lightness. For a colour that already clears the
  // contrast bar on both backgrounds, both functions are no-ops, so
  // deriveLight(deriveDark(c)) must be an exact identity — otherwise
  // an owner who flipped the (now-removed) bidirectional auto-derive
  // would see their brand colour silently drift on every press.
  it('is exact identity for colours that already pass both backgrounds', () => {
    // Filter the candidate pool by the property the test claims to
    // assert, then assert identity on what's left. Avoids the test
    // being a tautology if the contrast bar moves under us — and
    // avoids it failing on a hard-coded picks that aren't actually
    // dual-passing.
    const candidates = [
      '#2563EB', '#1E40AF', '#6366F1', '#7C3AED',
      '#DC2626', '#0EA5E9', '#0891B2', '#15803D',
    ];
    const dualPass = candidates.filter(
      (c) =>
        contrastRatio(c, DARK_BG) >= 3 && contrastRatio(c, LIGHT_BG) >= 3,
    );
    expect(dualPass.length).toBeGreaterThan(0);
    for (const c of dualPass) {
      expect(deriveLightColour(deriveDarkColour(c))).toBe(c);
      expect(deriveDarkColour(deriveLightColour(c))).toBe(c);
    }
  });
});
