import { describe, expect, it } from 'vitest';

import {
  hexToRgbTriplet,
  inviteUrl,
  joinUrl,
  normaliseHex,
  trialUrl,
  slugify,
} from './brand';

describe('normaliseHex', () => {
  it('accepts a valid 6-char hex with or without the hash', () => {
    expect(normaliseHex('#ff00aa')).toBe('#FF00AA');
    expect(normaliseHex('ff00AA')).toBe('#FF00AA');
  });
  it('rejects short / long / non-hex input', () => {
    expect(normaliseHex('#abc')).toBe(null);
    expect(normaliseHex('zzzzzz')).toBe(null);
    expect(normaliseHex('')).toBe(null);
  });
});

describe('slugify', () => {
  it('lowercases and collapses spaces', () => {
    expect(slugify('Iron Temple Gym')).toBe('iron-temple-gym');
  });
  it('strips punctuation', () => {
    expect(slugify("Bob's Box! 24/7")).toBe('bob-s-box-24-7');
  });
  it('trims edge dashes', () => {
    expect(slugify('---hello---')).toBe('hello');
  });
  it('returns empty for empty', () => {
    expect(slugify('')).toBe('');
  });
});

describe('joinUrl', () => {
  it('builds /join/<slug>', () => {
    expect(joinUrl('https://app.temple', 'iron-temple')).toBe(
      'https://app.temple/join/iron-temple',
    );
  });
  it('handles a trailing slash on the origin', () => {
    expect(joinUrl('https://app.temple/', 'iron-temple')).toBe(
      'https://app.temple/join/iron-temple',
    );
  });
});

describe('trialUrl', () => {
  it('builds /trial/<token>', () => {
    expect(trialUrl('https://app.temple', 'A1B2C3D4')).toBe(
      'https://app.temple/trial/A1B2C3D4',
    );
  });
  it('handles a trailing slash on the origin', () => {
    expect(trialUrl('https://app.temple/', 'A1B2C3D4')).toBe(
      'https://app.temple/trial/A1B2C3D4',
    );
  });
  // Tokens are hex today, but the URL builder is not the place to
  // assume that — a token with a slash in it must not invent a path.
  it('escapes the token', () => {
    expect(trialUrl('https://app.temple', 'a/b?c')).toBe(
      'https://app.temple/trial/a%2Fb%3Fc',
    );
  });
});

describe('inviteUrl', () => {
  it('builds /accept-invite?code=…', () => {
    expect(inviteUrl('https://app.temple', 'ABCD1234')).toBe(
      'https://app.temple/accept-invite?code=ABCD1234',
    );
  });
  it('url-encodes codes that contain unsafe characters', () => {
    expect(inviteUrl('https://app.temple', 'A B/C')).toBe(
      'https://app.temple/accept-invite?code=A%20B%2FC',
    );
  });
  it('handles a trailing slash on the origin', () => {
    expect(inviteUrl('https://app.temple/', 'X1Y2')).toBe(
      'https://app.temple/accept-invite?code=X1Y2',
    );
  });
});

describe('hexToRgbTriplet', () => {
  it('converts a hex with the leading hash', () => {
    expect(hexToRgbTriplet('#2563EB')).toBe('37 99 235');
  });
  it('converts a hex without the leading hash', () => {
    expect(hexToRgbTriplet('EBE925')).toBe('235 233 37');
  });
  it('handles pure black and pure white', () => {
    expect(hexToRgbTriplet('#000000')).toBe('0 0 0');
    expect(hexToRgbTriplet('#FFFFFF')).toBe('255 255 255');
  });
  it('falls back to the default for malformed input', () => {
    expect(hexToRgbTriplet('#nope')).toBe('194 65 12');
    expect(hexToRgbTriplet('')).toBe('194 65 12');
    expect(hexToRgbTriplet('zzzzzz')).toBe('194 65 12');
  });
});
