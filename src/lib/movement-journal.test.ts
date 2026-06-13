import { describe, expect, it } from 'vitest';

import {
  bestOfMerged,
  mergeJournal,
  prRowIds,
  type DirectInputRow,
  type TagInputRow,
} from './movement-journal';

function direct(
  partial: Partial<DirectInputRow> & {
    id: string;
    performed_at: string;
    value_numeric?: number | null;
    value_seconds?: number | null;
  },
): DirectInputRow {
  return {
    movement_key: 'back_squat',
    track_key: '1rm',
    workout_id: null,
    value_numeric: partial.value_numeric ?? null,
    value_seconds: partial.value_seconds ?? null,
    value_unit: partial.value_unit ?? null,
    notes: partial.notes ?? null,
    ...partial,
  };
}

function tag(
  partial: Partial<TagInputRow> & {
    id: string;
    performed_at: string;
    value_numeric?: number | null;
    value_seconds?: number | null;
  },
): TagInputRow {
  return {
    movement_key: 'back_squat',
    track_key: '1rm',
    workout_id: null,
    section_title: null,
    value_numeric: partial.value_numeric ?? null,
    value_seconds: partial.value_seconds ?? null,
    value_unit: partial.value_unit ?? null,
    notes: partial.notes ?? null,
    ...partial,
  };
}

describe('mergeJournal', () => {
  it('returns the direct rows unchanged when there are no tags', () => {
    const rows = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 100 }),
        direct({ id: 'd2', performed_at: '2026-06-02T00:00:00Z', value_numeric: 105 }),
      ],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['direct:d2', 'direct:d1']);
    expect(rows.every((r) => r.source === 'direct')).toBe(true);
  });

  it('returns the tag rows when there are no direct rows', () => {
    const rows = mergeJournal(
      [],
      [tag({ id: 't1', performed_at: '2026-06-03T00:00:00Z', value_numeric: 110 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('tag');
    expect(rows[0].id).toBe('tag:t1');
  });

  it('interleaves both sources by performed_at newest first', () => {
    const rows = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 100 }),
        direct({ id: 'd2', performed_at: '2026-06-03T00:00:00Z', value_numeric: 105 }),
      ],
      [
        tag({ id: 't1', performed_at: '2026-06-02T00:00:00Z', value_numeric: 110 }),
        tag({ id: 't2', performed_at: '2026-06-04T00:00:00Z', value_numeric: 115 }),
      ],
    );
    expect(rows.map((r) => r.id)).toEqual([
      'tag:t2',
      'direct:d2',
      'tag:t1',
      'direct:d1',
    ]);
  });

  it('keeps both rows when a tagged and a direct have the same timestamp + value', () => {
    // This is the explicitly documented behaviour: we don't try to
    // autoresolve duplicates because the dedup signal is unreliable.
    const rows = mergeJournal(
      [direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 110 })],
      [tag({ id: 't1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 110 })],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['direct', 'tag']));
  });

  it('preserves an empty source on both sides', () => {
    expect(mergeJournal([], [])).toEqual([]);
  });
});

describe('bestOfMerged', () => {
  const scheme = { metric: 'weight' as const, better: 'higher' as const };

  it('picks the higher weight across the union (direct wins)', () => {
    const merged = mergeJournal(
      [direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 120 })],
      [tag({ id: 't1', performed_at: '2026-06-02T00:00:00Z', value_numeric: 115 })],
    );
    const best = bestOfMerged(merged, '1rm', scheme);
    expect(best?.id).toBe('direct:d1');
    expect(best?.value_numeric).toBe(120);
  });

  it('picks the higher weight across the union (tag wins)', () => {
    const merged = mergeJournal(
      [direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 100 })],
      [tag({ id: 't1', performed_at: '2026-06-02T00:00:00Z', value_numeric: 115 })],
    );
    const best = bestOfMerged(merged, '1rm', scheme);
    expect(best?.id).toBe('tag:t1');
    expect(best?.value_numeric).toBe(115);
  });

  it('picks the lower time across the union for time schemes', () => {
    const timeScheme = { metric: 'time' as const, better: 'lower' as const };
    const merged = mergeJournal(
      [direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_seconds: 290 })],
      [tag({ id: 't1', performed_at: '2026-06-02T00:00:00Z', value_seconds: 250 })],
    );
    const best = bestOfMerged(
      merged.map((r) => ({ ...r, track_key: '5k' })),
      '5k',
      timeScheme,
    );
    expect(best?.id).toBe('tag:t1');
  });

  it('ignores rows on other scheme keys', () => {
    const merged = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 200 }),
      ],
      [
        tag({
          id: 't1',
          performed_at: '2026-06-02T00:00:00Z',
          value_numeric: 100,
          track_key: '5rm',
        }),
      ],
    );
    const best = bestOfMerged(merged, '1rm', scheme);
    expect(best?.id).toBe('direct:d1');
  });

  it('returns null when no row has the scheme key', () => {
    const merged = mergeJournal(
      [direct({ id: 'd1', performed_at: '2026-06-01T00:00:00Z', value_numeric: 100, track_key: '5rm' })],
      [],
    );
    expect(bestOfMerged(merged, '1rm', scheme)).toBe(null);
  });
});

describe('prRowIds', () => {
  const higherIsBetter = { metric: 'weight' as const, better: 'higher' as const };
  const lowerIsBetter = { metric: 'time' as const, better: 'lower' as const };

  it('marks every higher-better entry as PR until a non-improvement', () => {
    const merged = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-01-01T00:00:00Z', value_numeric: 100 }),
        direct({ id: 'd2', performed_at: '2026-02-01T00:00:00Z', value_numeric: 105 }),
        direct({ id: 'd3', performed_at: '2026-03-01T00:00:00Z', value_numeric: 105 }),
        direct({ id: 'd4', performed_at: '2026-04-01T00:00:00Z', value_numeric: 110 }),
      ],
      [],
    );
    const prs = prRowIds(merged, () => higherIsBetter);
    expect(Array.from(prs).sort()).toEqual(
      ['direct:d1', 'direct:d2', 'direct:d4'].sort(),
    );
  });

  it('lower-better scheme marks improving times', () => {
    const merged = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-01-01T00:00:00Z', value_seconds: 1200 }),
        direct({ id: 'd2', performed_at: '2026-02-01T00:00:00Z', value_seconds: 1180 }),
        direct({ id: 'd3', performed_at: '2026-03-01T00:00:00Z', value_seconds: 1190 }),
        direct({ id: 'd4', performed_at: '2026-04-01T00:00:00Z', value_seconds: 1100 }),
      ],
      [],
    );
    const prs = prRowIds(merged, () => lowerIsBetter);
    expect(Array.from(prs).sort()).toEqual(
      ['direct:d1', 'direct:d2', 'direct:d4'].sort(),
    );
  });

  it('keeps PRs scoped per track_key', () => {
    const merged = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-01-01T00:00:00Z', value_numeric: 100, track_key: '1rm' }),
        direct({ id: 'd2', performed_at: '2026-02-01T00:00:00Z', value_numeric: 60,  track_key: '5rm' }),
        direct({ id: 'd3', performed_at: '2026-03-01T00:00:00Z', value_numeric: 80,  track_key: '5rm' }),
      ],
      [],
    );
    const prs = prRowIds(merged, () => higherIsBetter);
    expect(prs.has('direct:d1')).toBe(true);
    expect(prs.has('direct:d2')).toBe(true);
    expect(prs.has('direct:d3')).toBe(true);
  });

  it('skips rows with missing values or unknown schemes', () => {
    const merged = mergeJournal(
      [
        direct({ id: 'd1', performed_at: '2026-01-01T00:00:00Z', value_numeric: 100 }),
        direct({ id: 'd2', performed_at: '2026-02-01T00:00:00Z', value_numeric: null }),
      ],
      [],
    );
    const prs = prRowIds(merged, () => undefined);
    expect(prs.size).toBe(0);
  });
});
