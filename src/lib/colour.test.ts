import { describe, expect, it } from 'vitest';

import { hexToHsv, hsvToHex } from './colour';

describe('hexToHsv', () => {
  it('parses primaries', () => {
    expect(hexToHsv('#FF0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00FF00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv('#0000FF')).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('parses greys with zero saturation', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#FFFFFF')).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('accepts missing # and rejects junk', () => {
    expect(hexToHsv('2563EB')).not.toBeNull();
    expect(hexToHsv('#25E')).toBeNull();
    expect(hexToHsv('hello!')).toBeNull();
  });
});

describe('hsvToHex', () => {
  it('renders primaries', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#FF0000');
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00FF00');
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000FF');
  });

  it('round-trips brand-ish colours within 1/255 per channel', () => {
    for (const hex of ['#2563EB', '#10B981', '#F97316', '#8B5CF6', '#0F172A']) {
      const hsv = hexToHsv(hex)!;
      const back = hsvToHex(hsv);
      const n1 = parseInt(hex.slice(1), 16);
      const n2 = parseInt(back.slice(1), 16);
      for (const shift of [16, 8, 0]) {
        const a = (n1 >> shift) & 255;
        const b = (n2 >> shift) & 255;
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
      }
    }
  });
});
