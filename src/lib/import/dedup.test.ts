import { describe, expect, it } from 'vitest';
import {
  dobsMatch,
  isLikelyDuplicate,
  namesMatch,
  normalizeName,
} from './dedup';

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  John Smith  ')).toBe('john smith');
  });

  it('strips diacritics', () => {
    expect(normalizeName('José Núñez')).toBe('jose nunez');
  });

  it('drops punctuation and collapses whitespace', () => {
    expect(normalizeName("Mary-Jane   O'Brien")).toBe('mary jane o brien');
  });

  it('reads a single comma as surname-first', () => {
    expect(normalizeName('Smith, John')).toBe('john smith');
    expect(normalizeName('Núñez, José')).toBe('jose nunez');
  });
  it('leaves a name with no comma (or an empty side) as-is', () => {
    expect(normalizeName('John Smith')).toBe('john smith');
    expect(normalizeName('Smith,')).toBe('smith');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});

describe('namesMatch', () => {
  it('matches identical normalized names', () => {
    expect(namesMatch('John Smith', 'john  smith')).toBe(true);
  });

  it('matches across diacritics and punctuation', () => {
    expect(namesMatch('José Núñez', 'Jose Nunez')).toBe(true);
  });

  it('tolerates an added middle name/initial', () => {
    expect(namesMatch('John Smith', 'John A Smith')).toBe(true);
    expect(namesMatch('John A Smith', 'John Smith')).toBe(true);
  });

  it('does not match different last names', () => {
    expect(namesMatch('John Smith', 'John Jones')).toBe(false);
  });

  it('does not match different first names', () => {
    expect(namesMatch('John Smith', 'Jane Smith')).toBe(false);
  });

  it('matches surname-first against natural order', () => {
    expect(namesMatch('Smith, John', 'John Smith')).toBe(true);
    expect(namesMatch('Smith, John A', 'John Smith')).toBe(true);
  });
  it('requires exact match for single-token names', () => {
    expect(namesMatch('John', 'John')).toBe(true);
    expect(namesMatch('John', 'John Smith')).toBe(false);
  });

  it('returns false when either name is empty', () => {
    expect(namesMatch('', 'John Smith')).toBe(false);
    expect(namesMatch('John Smith', null)).toBe(false);
    expect(namesMatch(null, undefined)).toBe(false);
  });
});

describe('dobsMatch', () => {
  it('matches equal ISO dates', () => {
    expect(dobsMatch('1990-05-01', '1990-05-01')).toBe(true);
  });

  it('ignores a time component', () => {
    expect(dobsMatch('1990-05-01T00:00:00Z', '1990-05-01')).toBe(true);
  });

  it('does not match different dates', () => {
    expect(dobsMatch('1990-05-01', '1991-05-01')).toBe(false);
  });

  it('returns false when either date is missing or malformed', () => {
    expect(dobsMatch(null, '1990-05-01')).toBe(false);
    expect(dobsMatch('1990-05-01', undefined)).toBe(false);
    expect(dobsMatch('01/05/1990', '01/05/1990')).toBe(false);
  });
});

describe('isLikelyDuplicate', () => {
  it('matches on name+dob when both carry a matching DOB', () => {
    const r = isLikelyDuplicate(
      { name: 'John Smith', dob: '1990-05-01' },
      { name: 'John Smith', dob: '1990-05-01' },
    );
    expect(r).toEqual({ match: true, confidence: 'name+dob' });
  });

  it('rules out two same-name people with different DOBs', () => {
    const r = isLikelyDuplicate(
      { name: 'John Smith', dob: '1990-05-01' },
      { name: 'John Smith', dob: '1975-11-20' },
    );
    expect(r.match).toBe(false);
  });

  it('name-only match when one side lacks a DOB (e.g. Stripe)', () => {
    const r = isLikelyDuplicate(
      { name: 'John Smith', dob: '1990-05-01' },
      { name: 'John Smith' },
    );
    expect(r).toEqual({ match: true, confidence: 'name' });
  });

  it('name-only match when neither side has a DOB', () => {
    const r = isLikelyDuplicate(
      { name: 'John Smith' },
      { name: 'John A Smith' },
    );
    expect(r).toEqual({ match: true, confidence: 'name' });
  });

  it('no match when names differ regardless of DOB', () => {
    const r = isLikelyDuplicate(
      { name: 'John Smith', dob: '1990-05-01' },
      { name: 'Jane Doe', dob: '1990-05-01' },
    );
    expect(r.match).toBe(false);
  });
});
