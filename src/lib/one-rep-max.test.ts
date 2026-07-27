import { describe, expect, it } from 'vitest';

import type { JournalRow } from './movement-journal';
import {
  estimateOneRepMax,
  formatWeight,
  percentWeight,
  repsForScheme,
  resolveOneRepMax,
} from './one-rep-max';

const REP_MAX = (reps: number) => ({
  key: `${reps}rm`,
  label: `${reps} Rep Max`,
  metric: 'weight' as const,
  better: 'higher' as const,
});

const BACK_SQUAT = { schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)] };

function row(
  trackKey: string,
  value: number,
  opts: { unit?: string | null; at?: string } = {},
): JournalRow {
  return {
    id: `direct:${trackKey}:${value}`,
    source: 'direct',
    movement_key: 'back_squat',
    track_key: trackKey,
    workout_id: 'w1',
    section_title: null,
    value_numeric: value,
    value_seconds: null,
    value_unit: opts.unit === undefined ? 'kg' : opts.unit,
    notes: null,
    performed_at: opts.at ?? '2026-01-01T12:00:00Z',
  };
}

describe('estimateOneRepMax', () => {
  it('is the identity at one rep', () => {
    expect(estimateOneRepMax(140, 1)).toBe(140);
  });

  it('applies Epley above one rep', () => {
    // 100 * (1 + 5/30) = 116.67
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.667, 3);
    expect(estimateOneRepMax(100, 3)).toBeCloseTo(110, 6);
    expect(estimateOneRepMax(60, 10)).toBeCloseTo(80, 6);
  });

  it('refuses nonsense input', () => {
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(estimateOneRepMax(Number.NaN, 5)).toBe(0);
  });
});

describe('repsForScheme', () => {
  it('reads the rep count off a rep-max key', () => {
    expect(repsForScheme('1rm')).toBe(1);
    expect(repsForScheme('10rm')).toBe(10);
  });

  it('rejects non rep-max schemes', () => {
    expect(repsForScheme('5k')).toBeNull();
    expect(repsForScheme('max_reps')).toBeNull();
  });
});

describe('resolveOneRepMax', () => {
  it('returns null with nothing logged', () => {
    expect(resolveOneRepMax([], BACK_SQUAT)).toBeNull();
  });

  it('returns null for a movement with no weight scheme', () => {
    const runner = {
      schemes: [
        { key: '5k', label: '5k', metric: 'time' as const, better: 'lower' as const },
      ],
    };
    expect(resolveOneRepMax([row('5k', 1200)], runner)).toBeNull();
  });

  it('prefers a recorded 1RM over any estimate', () => {
    const res = resolveOneRepMax(
      [row('1rm', 100), row('5rm', 95)],
      BACK_SQUAT,
    );
    // 5RM of 95 would estimate to 110.8 — the recorded single still wins.
    expect(res).toMatchObject({ kind: 'max', value: 100, source: 'recorded', fromScheme: '1rm' });
  });

  it('estimates from a rep max when no 1RM is recorded', () => {
    const res = resolveOneRepMax([row('5rm', 90)], BACK_SQUAT);
    expect(res).toMatchObject({
      kind: 'max',
      source: 'estimated',
      fromScheme: '5rm',
      fromValue: 90,
      fromReps: 5,
    });
    expect(res?.kind === 'max' && res.value).toBeCloseTo(105, 6);
  });

  it('takes the highest estimate across rep maxes', () => {
    // 3RM 100 -> 110; 5RM 95 -> 110.83; 10RM 70 -> 93.3
    const res = resolveOneRepMax(
      [row('3rm', 100), row('5rm', 95), row('10rm', 70)],
      BACK_SQUAT,
    );
    expect(res).toMatchObject({ fromScheme: '5rm' });
    expect(res?.kind === 'max' && res.value).toBeCloseTo(110.833, 3);
  });

  // This used to resolve to unit_unknown and the card said "your results
  // are recorded in pounds". Storage is kilograms now (0181) — the
  // importer converts and the old rows were backfilled — so a stored
  // number is a stored number and the resolver just ranks them.
  it('ranks every row now that storage is one unit', () => {
    const res = resolveOneRepMax(
      [row('1rm', 200, { unit: 'kg' }), row('3rm', 142.9, { unit: 'kg' })],
      BACK_SQUAT,
    );
    expect(res).toMatchObject({ kind: 'max', value: 200, fromScheme: '1rm' });
  });

  it('treats a missing unit as kg', () => {
    const res = resolveOneRepMax([row('1rm', 120, { unit: null })], BACK_SQUAT);
    expect(res).toMatchObject({ kind: 'max', value: 120, unit: 'kg' });
  });

  it('ignores rep-max keys the catalogue does not define for the movement', () => {
    // The CSV importer writes `${reps}rm` for any rep count, so 20rm
    // rows exist. Epley at 20 reps is w x 1.67 — nonsense to load.
    const res = resolveOneRepMax([row('20rm', 100), row('5rm', 90)], BACK_SQUAT);
    expect(res).toMatchObject({ fromScheme: '5rm' });
  });

  it('breaks an estimate tie on fewer reps', () => {
    // 3RM 90 -> 99; 10RM 74.25 -> 99. Same estimate, prefer the triple.
    const res = resolveOneRepMax(
      [row('3rm', 90), row('10rm', 74.25)],
      BACK_SQUAT,
    );
    expect(res).toMatchObject({ fromScheme: '3rm' });
  });
});

describe('percentWeight', () => {
  it('rounds to the nearest 2.5 kg', () => {
    expect(percentWeight(100, 75)).toBe(75);
    expect(percentWeight(102, 75)).toBe(77.5);
    expect(percentWeight(100, 62)).toBe(62.5);
  });

  it('handles the ends of the range', () => {
    expect(percentWeight(100, 100)).toBe(100);
    expect(percentWeight(100, 50)).toBe(50);
  });
});

describe('formatWeight', () => {
  it('drops a trailing zero decimal', () => {
    expect(formatWeight(80, 'kg')).toBe('80 kg');
    expect(formatWeight(82.5, 'kg')).toBe('82.5 kg');
  });
});
