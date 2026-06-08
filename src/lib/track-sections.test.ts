import { describe, expect, it } from 'vitest';

import {
  emptyEntryDraft,
  entryDraftIsEmpty,
  entryLabelFor,
  FORMAT_SHAPES,
  isAggregateFirst,
  isEntriesOnly,
  isNotesOnly,
} from './track-sections';

describe('FORMAT_SHAPES catalog', () => {
  it('has a shape for every section format key', () => {
    for (const k of [
      'for_time',
      'amrap',
      'emom',
      'intervals',
      'strength_sets',
      'max_load',
      'no_score',
      'other',
    ] as const) {
      expect(FORMAT_SHAPES[k]).toBeDefined();
    }
  });

  it('classifies formats consistently', () => {
    expect(isAggregateFirst('for_time')).toBe(true);
    expect(isAggregateFirst('amrap')).toBe(true);
    expect(isAggregateFirst('max_load')).toBe(true);
    expect(isAggregateFirst('emom')).toBe(false);

    expect(isEntriesOnly('emom')).toBe(true);
    expect(isEntriesOnly('intervals')).toBe(true);
    expect(isEntriesOnly('strength_sets')).toBe(true);
    expect(isEntriesOnly('for_time')).toBe(false);

    expect(isNotesOnly('no_score')).toBe(true);
    expect(isNotesOnly('other')).toBe(true);
    expect(isNotesOnly('for_time')).toBe(false);
  });

  it('labels entries per format', () => {
    expect(entryLabelFor('emom', 3)).toBe('Minute 3');
    expect(entryLabelFor('intervals', 2)).toBe('Interval 2');
    expect(entryLabelFor('strength_sets', 1)).toBe('Set 1');
    expect(entryLabelFor('amrap', 7)).toBe('Round 7');
    expect(entryLabelFor('for_time', 1)).toBe('Split 1');
    expect(entryLabelFor('max_load', 1)).toBe('Set 1');
    expect(entryLabelFor('no_score', 1)).toBe('Entry 1');
  });
});

describe('entryDraftIsEmpty', () => {
  it('returns true for a fresh draft', () => {
    expect(entryDraftIsEmpty(emptyEntryDraft(), 'strength_sets')).toBe(true);
    expect(entryDraftIsEmpty(emptyEntryDraft(), 'emom')).toBe(true);
  });

  it('returns false when a relevant metric is filled', () => {
    const e = { ...emptyEntryDraft(), weight: '100' };
    expect(entryDraftIsEmpty(e, 'strength_sets')).toBe(false);
  });

  it('respects per-format relevance — irrelevant metric is ignored', () => {
    // Strength sets cares about weight + reps; a calories value alone
    // should not save the row.
    const e = { ...emptyEntryDraft(), calories: '15' };
    expect(entryDraftIsEmpty(e, 'strength_sets')).toBe(true);
    // Intervals cares about calories.
    expect(entryDraftIsEmpty(e, 'intervals')).toBe(false);
  });

  it('treats the done flag as content for round-based formats', () => {
    const e = { ...emptyEntryDraft(), done: true };
    expect(entryDraftIsEmpty(e, 'emom')).toBe(false);
  });
});
