import { describe, expect, it } from 'vitest';

import {
  aggregateHeadline,
  emptyEntryDraft,
  entryDraftIsEmpty,
  entryLabelFor,
  FORMAT_SHAPES,
  isAggregateFirst,
  isEntriesOnly,
  isNotesOnly,
  type SectionAggregates,
} from './track-sections';

describe('FORMAT_SHAPES catalog', () => {
  it('has a shape for every section format key', () => {
    for (const k of [
      'for_time',
      'amrap',
      'emom',
      'intervals',
      'max_distance',
      'max_calories',
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
    expect(isAggregateFirst('max_distance')).toBe(true);
    expect(isAggregateFirst('max_calories')).toBe(true);
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
    expect(entryLabelFor('max_distance', 2)).toBe('Split 2');
    expect(entryLabelFor('max_calories', 3)).toBe('Split 3');
    expect(entryLabelFor('max_load', 1)).toBe('Set 1');
    expect(entryLabelFor('no_score', 1)).toBe('Entry 1');
  });
});

describe('aggregateHeadline', () => {
  function section(partial: Partial<SectionAggregates>): SectionAggregates {
    return {
      section_format: 'for_time',
      title: null,
      body: null,
      total_time_seconds: null,
      total_rounds: null,
      total_extra_reps: null,
      total_distance_m: null,
      total_calories: null,
      did_not_finish: null,
      ...partial,
    };
  }

  it('renders for_time as before', () => {
    expect(aggregateHeadline(section({ total_time_seconds: 272 }))).toBe('4:32');
    expect(
      aggregateHeadline(section({ total_time_seconds: 600, did_not_finish: true })),
    ).toBe('10:00 · DNF');
  });

  it('renders amrap rounds + extra reps', () => {
    expect(
      aggregateHeadline(
        section({ section_format: 'amrap', total_rounds: 7, total_extra_reps: 5 }),
      ),
    ).toBe('7 rounds + 5 reps');
  });

  it('renders max_distance with derived erg pace', () => {
    expect(
      aggregateHeadline(
        section({
          section_format: 'max_distance',
          title: '20 min row',
          body: 'Max distance row',
          total_distance_m: 5000,
          total_time_seconds: 1200,
        }),
      ),
    ).toBe('20:00 · 5000 m · 2:00 /500m');
  });

  it('renders running distance with /km pace', () => {
    expect(
      aggregateHeadline(
        section({
          section_format: 'max_distance',
          title: 'Run',
          body: '20 min max distance run',
          total_distance_m: 4000,
          total_time_seconds: 1200,
        }),
      ),
    ).toBe('20:00 · 4000 m · 5:00 /km');
  });

  it('renders distance alone without pace', () => {
    expect(
      aggregateHeadline(
        section({ section_format: 'max_distance', total_distance_m: 5000 }),
      ),
    ).toBe('5000 m');
  });

  it('renders max_calories', () => {
    expect(
      aggregateHeadline(
        section({
          section_format: 'max_calories',
          total_calories: 142,
          total_time_seconds: 720,
        }),
      ),
    ).toBe('12:00 · 142 cal');
  });

  it('returns null for empty aggregates and non-aggregate formats', () => {
    expect(aggregateHeadline(section({}))).toBe(null);
    expect(
      aggregateHeadline(section({ section_format: 'emom', total_time_seconds: 60 })),
    ).toBe(null);
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
