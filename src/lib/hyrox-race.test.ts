import { describe, expect, it } from 'vitest';

import {
  allSplitsFilled,
  computeRaceTotals,
  emptyRaceSplits,
  RACE_STATIONS,
  sumSeconds,
} from './hyrox-race';

describe('emptyRaceSplits', () => {
  it('produces 24 segments in run, roxzone, station order per lap', () => {
    const splits = emptyRaceSplits();
    expect(splits).toHaveLength(24);
    for (let lap = 0; lap < 8; lap++) {
      const [run, roxzone, station] = splits.slice(lap * 3, lap * 3 + 3);
      expect(run.segmentType).toBe('run');
      expect(roxzone.segmentType).toBe('roxzone');
      expect(station.segmentType).toBe('station');
      expect(run.segmentIndex).toBe(lap + 1);
      expect(station.stationKey).toBe(RACE_STATIONS[lap].key);
    }
  });

  it('starts every segment unfilled', () => {
    expect(emptyRaceSplits().every((s) => s.seconds === null)).toBe(true);
  });
});

describe('sumSeconds', () => {
  it('treats null as zero', () => {
    expect(sumSeconds([10, null, 20, null])).toBe(30);
  });

  it('sums an empty array to zero', () => {
    expect(sumSeconds([])).toBe(0);
  });
});

describe('allSplitsFilled', () => {
  it('is false while any segment is null', () => {
    const splits = emptyRaceSplits();
    splits[0].seconds = 60;
    expect(allSplitsFilled(splits)).toBe(false);
  });

  it('is true once every segment has a non-negative value', () => {
    const splits = emptyRaceSplits().map((s) => ({ ...s, seconds: 60 }));
    expect(allSplitsFilled(splits)).toBe(true);
  });
});

describe('computeRaceTotals', () => {
  it('sums each segment type independently and combines them into a total', () => {
    const splits = emptyRaceSplits().map((s) => ({
      ...s,
      seconds: s.segmentType === 'run' ? 300 : s.segmentType === 'station' ? 120 : 30,
    }));
    const totals = computeRaceTotals(splits);
    expect(totals).toEqual({
      runTotalSeconds: 8 * 300,
      stationTotalSeconds: 8 * 120,
      roxzoneTotalSeconds: 8 * 30,
      totalSeconds: 8 * 300 + 8 * 120 + 8 * 30,
    });
  });
});
