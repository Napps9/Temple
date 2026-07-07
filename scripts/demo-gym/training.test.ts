import { describe, expect, it } from 'vitest';

import { HYROX_SIM } from '../../src/lib/hyrox';
import { findMovement } from '../../src/lib/movements';
import { mulberry32 } from './roster';
import { buildRace, focusPool, progressionSeries } from './training';

describe('focusPool', () => {
  it('only contains movement/scheme pairs that resolve in the live catalog', () => {
    const pool = focusPool();
    expect(pool.length).toBeGreaterThanOrEqual(10);
    for (const focus of pool) {
      const hit = findMovement(focus.movementKey);
      expect(hit, `movement ${focus.movementKey} missing from catalog`).toBeTruthy();
      const scheme = hit!.movement.schemes.find((s) => s.key === focus.trackKey);
      expect(scheme, `${focus.movementKey}/${focus.trackKey} missing`).toBeTruthy();
      expect(scheme!.metric).toBe(focus.metric);
    }
  });
});

describe('progressionSeries', () => {
  it('weights are non-decreasing, plate-friendly, and end on the all-time best', () => {
    const rng = mulberry32(42);
    const series = progressionSeries(rng, { movementKey: 'back_squat', trackKey: '1rm', metric: 'weight', better: 'higher' }, 20);
    expect(series).toHaveLength(20);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
    expect(series[series.length - 1]).toBe(Math.max(...series));
    for (const v of series) expect((v * 10) % 25).toBe(0); // 2.5kg increments
  });

  it('times trend down and end on the fastest', () => {
    const rng = mulberry32(42);
    const series = progressionSeries(rng, { movementKey: 'run_5k', trackKey: '5k', metric: 'time', better: 'lower' }, 12);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
    }
    expect(series[series.length - 1]).toBe(Math.min(...series));
  });
});

describe('buildRace', () => {
  it('produces exactly 8 of each segment type with totals equal to split sums', () => {
    const rng = mulberry32(42);
    const race = buildRace(rng, 'full', 'mens');
    expect(race.splits).toHaveLength(24);
    for (const type of ['run', 'station', 'roxzone'] as const) {
      const ofType = race.splits.filter((s) => s.segmentType === type);
      expect(ofType).toHaveLength(8);
      expect(new Set(ofType.map((s) => s.segmentIndex))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    }
    const sum = (t: string) =>
      race.splits.filter((s) => s.segmentType === t).reduce((acc, s) => acc + (s.seconds ?? 0), 0);
    expect(race.runTotalSeconds).toBe(sum('run'));
    expect(race.stationTotalSeconds).toBe(sum('station'));
    expect(race.roxzoneTotalSeconds).toBe(sum('roxzone'));
    expect(race.totalSeconds).toBe(race.runTotalSeconds + race.stationTotalSeconds + race.roxzoneTotalSeconds);
    expect(race.splits.filter((s) => s.segmentType === 'station').every((s) => s.stationKey)).toBe(true);
  });

  it('a half race is meaningfully faster than a full one', () => {
    const full = buildRace(mulberry32(1), 'full', 'mens');
    const half = buildRace(mulberry32(1), 'half', 'mens');
    expect(half.totalSeconds).toBeLessThan(full.totalSeconds);
  });

  it('logs against the real hyrox_sim movement and its scheme keys', () => {
    expect(HYROX_SIM.key).toBe('hyrox_sim');
    const schemeKeys = HYROX_SIM.schemes.map((s) => s.key);
    expect(schemeKeys).toContain('full');
    expect(schemeKeys).toContain('half');
  });
});
