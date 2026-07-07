import { describe, expect, it } from 'vitest';

import { contrastRatio } from './brand-derivation';
import {
  BRAND_THEME_LIST,
  BRAND_THEMES,
  composeThemeWithBrand,
  isThemeId,
} from './brand-themes';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('BRAND_THEMES', () => {
  it('has exactly the four planned themes, each with valid hex values', () => {
    expect(BRAND_THEME_LIST.map((t) => t.id).sort()).toEqual([
      'baseline',
      'daybreak',
      'forged',
      'ringside',
    ]);
    for (const theme of BRAND_THEME_LIST) {
      for (const hex of Object.values(theme.palette)) {
        expect(hex).toMatch(HEX);
      }
    }
  });

  it('every theme declares a valid schedule-block clock format', () => {
    for (const theme of BRAND_THEME_LIST) {
      expect(['12h', '24h']).toContain(theme.typography.timeFormat);
    }
  });

  it('every theme accent is readable against its own background out of the box', () => {
    for (const theme of BRAND_THEME_LIST) {
      expect(contrastRatio(theme.palette.accent, theme.palette.background)).toBeGreaterThanOrEqual(
        3,
      );
      expect(
        contrastRatio(theme.palette.accentText, theme.palette.accent),
      ).toBeGreaterThanOrEqual(2.5);
    }
  });
});

describe('isThemeId', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isThemeId('forged')).toBe(true);
    expect(isThemeId('ringside')).toBe(true);
    expect(isThemeId('made-up')).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });
});

describe('composeThemeWithBrand', () => {
  it('substitutes the gym colour as accent when it is legible against the background', () => {
    // A saturated blue reads fine against Baseline's light background.
    const composed = composeThemeWithBrand(BRAND_THEMES.baseline, '#2563EB');
    expect(composed.palette.accent).toBe('#2563EB');
    expect(composed.id).toBe('baseline');
    expect(composed.palette.background).toBe(BRAND_THEMES.baseline.palette.background);
  });

  it('falls back to the theme stock accent when the gym colour would be unreadable', () => {
    // Near-black brand colour on Forged's near-black background: illegible.
    const composed = composeThemeWithBrand(BRAND_THEMES.forged, '#0B0B0C');
    expect(composed.palette.accent).toBe(BRAND_THEMES.forged.palette.accent);
  });

  it('always returns an accentText that is more readable than the alternative', () => {
    for (const theme of BRAND_THEME_LIST) {
      for (const brandHex of ['#2563EB', '#F5F5F0', '#0B0B0C', '#14B8A6']) {
        const composed = composeThemeWithBrand(theme, brandHex);
        const chosen = contrastRatio(composed.palette.accentText, composed.palette.accent);
        const other =
          composed.palette.accentText === '#FFFFFF'
            ? contrastRatio(theme.palette.text, composed.palette.accent)
            : contrastRatio('#FFFFFF', composed.palette.accent);
        expect(chosen).toBeGreaterThanOrEqual(other);
      }
    }
  });

  it('does not mutate the source theme', () => {
    const before = JSON.stringify(BRAND_THEMES.ringside);
    composeThemeWithBrand(BRAND_THEMES.ringside, '#00FF00');
    expect(JSON.stringify(BRAND_THEMES.ringside)).toBe(before);
  });
});

describe('accessibility floors', () => {
  it('every theme mutedText clears WCAG AA (4.5:1) on both background and surface', () => {
    for (const t of BRAND_THEME_LIST) {
      expect(contrastRatio(t.palette.mutedText, t.palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.palette.mutedText, t.palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects a gym colour whose best button-label ink misses 4.5:1', () => {
    // Mid-luminance red: legible against a light page background
    // (clears the 3:1 fill floor) but neither white nor dark ink
    // reaches 4.5:1 on top of it — must fall back to the stock accent.
    const awkward = '#E05050';
    const composed = composeThemeWithBrand(BRAND_THEMES.baseline, awkward);
    expect(contrastRatio(awkward, BRAND_THEMES.baseline.palette.background)).toBeGreaterThanOrEqual(3);
    expect(composed.palette.accent).toBe(BRAND_THEMES.baseline.palette.accent);
  });

  it('still adopts a gym colour when a readable label ink exists', () => {
    const composed = composeThemeWithBrand(BRAND_THEMES.baseline, '#1D4ED8');
    expect(composed.palette.accent).toBe('#1D4ED8');
    expect(contrastRatio('#1D4ED8', composed.palette.accentText)).toBeGreaterThanOrEqual(4.5);
  });
});
