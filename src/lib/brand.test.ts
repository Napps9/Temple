import { describe, expect, it } from 'vitest';

import { gymInitial, joinUrl, normaliseHex, slugify } from './brand';

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

describe('gymInitial', () => {
  it('returns the first character upper-cased', () => {
    expect(gymInitial('iron temple')).toBe('I');
    expect(gymInitial('Temple')).toBe('T');
  });
  it('falls back to T for empty', () => {
    expect(gymInitial('')).toBe('T');
    expect(gymInitial('   ')).toBe('T');
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
