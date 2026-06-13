import { describe, expect, it } from 'vitest';

import { joinName, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple row', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('handles quoted cells with embedded commas', () => {
    expect(parseCsv('"a, b",c\n"x","y"')).toEqual([
      ['a, b', 'c'],
      ['x', 'y'],
    ]);
  });
  it('handles escaped quotes inside a quoted cell', () => {
    expect(parseCsv('"she said ""hi""",x')).toEqual([['she said "hi"', 'x']]);
  });
  it('handles embedded newlines in quoted cells', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });
  it('strips a UTF-8 BOM at the start', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('trims whitespace from cells', () => {
    expect(parseCsv('  a , b ,  c\n')).toEqual([['a', 'b', 'c']]);
  });
  it('ignores empty trailing lines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('handles CRLF line endings (Excel default)', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('joinName', () => {
  it('joins first + last', () => {
    expect(joinName(['Ada', 'Lovelace'])).toBe('Ada Lovelace');
  });
  it('falls back to just one of them', () => {
    expect(joinName(['Ada', ''])).toBe('Ada');
    expect(joinName([null, 'Lovelace'])).toBe('Lovelace');
  });
  it('returns null when both are empty', () => {
    expect(joinName([null, ' '])).toBe(null);
  });
});
