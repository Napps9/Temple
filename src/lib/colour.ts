// Pure hex ↔ HSV conversions for the brand colour picker. No deps, no
// React — unit-tested in colour.test.ts.

export type Hsv = { h: number; s: number; v: number }; // h 0-360, s/v 0-1

export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (u: number) =>
    Math.round((u + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to255(r)}${to255(g)}${to255(b)}`.toUpperCase();
}

// Drops HSV value by `amount` (0-1). Used for the second stop of a
// brand-coloured gradient — a gym's own colour, just darker, rather
// than a second hard-coded hue.
export function darkenHex(hex: string, amount: number): string {
  const hsv = hexToHsv(hex);
  if (!hsv) return hex;
  return hsvToHex({ ...hsv, v: Math.max(0, hsv.v * (1 - amount)) });
}
