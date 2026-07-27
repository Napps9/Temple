import { describe, expect, it } from 'vitest';

import {
  describeBulkEdit,
  describeBulkEditResult,
  parseOptionalInt,
  validateBulkEdit,
} from './bulk-class-edit';

describe('parseOptionalInt', () => {
  it('treats blank as "leave unchanged", not zero', () => {
    expect(parseOptionalInt('')).toBeNull();
    expect(parseOptionalInt('   ')).toBeNull();
    expect(parseOptionalInt('0')).toBe(0);
  });

  it('accepts negatives, for shifting classes earlier', () => {
    expect(parseOptionalInt('-30')).toBe(-30);
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseOptionalInt('12.5')).toBe('invalid');
    expect(parseOptionalInt('lots')).toBe('invalid');
    expect(parseOptionalInt('8a')).toBe('invalid');
  });
});

describe('validateBulkEdit', () => {
  it('requires at least one field', () => {
    expect(validateBulkEdit('', '', '')).toEqual({
      error: 'Change at least one of capacity, duration or start time',
    });
  });

  it('allows a shift on its own', () => {
    expect(validateBulkEdit('', '', '-60')).toEqual({
      fields: { capacity: null, durationMinutes: null, shiftMinutes: -60 },
    });
  });

  it('rejects a capacity of zero but not a shift of zero', () => {
    expect(validateBulkEdit('0', '', '')).toEqual({
      error: 'Capacity must be at least 1',
    });
    expect(validateBulkEdit('', '', '0')).toEqual({
      fields: { capacity: null, durationMinutes: null, shiftMinutes: 0 },
    });
  });

  it('rejects a non-numeric duration', () => {
    expect(validateBulkEdit('', 'an hour', '')).toEqual({
      error: 'Duration must be a whole number',
    });
  });
});

describe('describeBulkEdit', () => {
  it('names every field being changed', () => {
    expect(
      describeBulkEdit({ capacity: 8, durationMinutes: 45, shiftMinutes: 90 }, 12),
    ).toBe('12 classes: capacity 8, 45 minutes long, starting 1h 30m later.');
  });

  it('renders a sub-hour shift without an hours part', () => {
    expect(
      describeBulkEdit({ capacity: null, durationMinutes: null, shiftMinutes: -30 }, 1),
    ).toBe('1 class: starting 30m earlier.');
  });

  it('ignores a zero shift', () => {
    expect(
      describeBulkEdit({ capacity: null, durationMinutes: null, shiftMinutes: 0 }, 3),
    ).toBe('Nothing will change.');
  });
});

describe('describeBulkEditResult', () => {
  it('reports only what happened', () => {
    expect(
      describeBulkEditResult({
        updated: 9,
        skipped_overbooked: 0,
        skipped_past: 0,
        skipped_conflict: 0,
        notified: 0,
      }),
    ).toBe('9 classes updated.');
  });

  it('explains each kind of skip', () => {
    expect(
      describeBulkEditResult({
        updated: 4,
        skipped_overbooked: 2,
        skipped_past: 1,
        skipped_conflict: 1,
        notified: 6,
      }),
    ).toBe(
      '4 classes updated. 2 left alone — more members are booked in than the new capacity. ' +
        '1 skipped — the new time is in the past. ' +
        '1 skipped — the new time clashes with another class in the series. ' +
        '6 members told.',
    );
  });
});
