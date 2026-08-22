// WCAG contrast maths. This file used to also derive a dark-mode
// sibling for a gym's brand colour by walking HSL lightness until it
// cleared the contrast bar; gyms no longer recolour Temple's chrome, so
// only the ratio itself is left. Its callers are the two places a label
// has to be legible on a fill it does not control — Button's and
// ChipButton's filled variants — plus the email and site theme
// registries, which check their own palettes.
type RGB = { r: number; g: number; b: number };

function parseHex(hex: string): RGB | null {
  const clean = hex.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
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

// The label for text sitting on an arbitrary content fill — a class
// type's colour, a tag's colour — picked the way Button used to pick on
// the brand: whichever of white / near-black ink reads better. The
// accent itself does not come through here; it has the on-primary token.
export function labelOn(fill: string): string {
  return contrastRatio(fill, '#FFFFFF') >= contrastRatio(fill, '#111827')
    ? '#FFFFFF'
    : '#111827';
}
