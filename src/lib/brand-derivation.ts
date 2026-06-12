// Brand-colour derivation: given a colour designed for one mode,
// compute a sibling that works on the opposite mode's background.
//
// Approach: keep hue + saturation (so the brand identity carries
// over) and only nudge HSL lightness, using WCAG contrast against the
// target background as the stopping condition. Colours that already
// have ≥ 3:1 contrast against the target are returned unchanged — a
// mid-saturation brand yellow that already reads well on both modes
// doesn't need to drift. The canonical bad case is pure black on
// dark mode (contrast ≈ 1:1, invisible): the loop lifts L until the
// resulting grey clears the contrast bar.

// Same screen-bg pair the rest of the app already uses (see theme.ts
// useThemeColors). Hard-coding them here keeps the lib React-free
// and unit-testable; if either changes, the lib's import-points
// (useGymBrand, the Advanced branding panel) re-read at runtime.
export const LIGHT_BG = '#F1F5F9';
export const DARK_BG = '#030712';

// Minimum WCAG 2.x contrast ratio we want a brand colour to clear
// against the screen background. 3:1 is the "large text / UI" floor.
// Body text uses 4.5:1 but brand-tinted body text is rare in this app
// (most copy is plain gray-900/50); buttons + accents are the
// dominant use, so the looser bar avoids over-flattening saturated
// hues that already read fine.
const MIN_CONTRAST = 3;

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseHex(hex: string): RGB | null {
  const clean = hex.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function toHex(rgb: RGB): string {
  const part = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
    }
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function relativeLuminance(rgb: RGB): number {
  // WCAG 2 sRGB → linear → weighted sum.
  const chan = (c: number): number => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 1;
  const la = relativeLuminance(ra);
  const lb = relativeLuminance(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Walk lightness in `step` increments toward the target until the
// resulting colour clears MIN_CONTRAST against `bg`. Returns the
// adjusted hex. `direction = 1` lifts L (for dark-mode derivation),
// `-1` lowers it (for light-mode derivation).
function adjustForContrast(
  hex: string,
  bg: string,
  direction: 1 | -1,
): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  if (contrastRatio(hex, bg) >= MIN_CONTRAST) return hex;
  const hsl = rgbToHsl(rgb);
  const step = 0.04;
  // Bound the search so a fully achromatic colour (S=0) on the wrong
  // side still ends somewhere visible rather than at pure black/white.
  const min = 0.05;
  const max = 0.95;
  let l = hsl.l;
  let trial = hex;
  for (let i = 0; i < 25; i += 1) {
    const nextL = clamp(l + direction * step, min, max);
    // Hit the boundary AND can't move further — best we can do.
    if (nextL === l) break;
    l = nextL;
    trial = toHex(hslToRgb({ ...hsl, l }));
    if (contrastRatio(trial, bg) >= MIN_CONTRAST) return trial;
  }
  return trial;
}

// Derive a dark-mode variant of a colour that was picked for light
// mode. Lifts lightness until the colour clears the contrast bar
// against the dark screen background.
export function deriveDarkColour(hex: string): string {
  return adjustForContrast(hex, DARK_BG, 1);
}

// Derive a light-mode variant of a colour picked for dark mode. The
// mirror operation: drop lightness until it clears the contrast bar
// against the light screen background.
export function deriveLightColour(hex: string): string {
  return adjustForContrast(hex, LIGHT_BG, -1);
}
