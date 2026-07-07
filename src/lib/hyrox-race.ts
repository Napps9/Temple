// Pure helpers for the split-by-split race simulation builder
// (RecordHyroxRaceModal). A race is 8 laps of run → roxzone → station,
// in course order — 24 timed segments total, laid out here so the UI
// and the save path share one source of truth for ordering and totals.

import { HYROX_STATIONS } from './hyrox';

// The 8 real stations in course order, excluding HYROX_STATIONS[0]
// (the generic "Run" catalog entry, which represents all 8 run splits
// collectively for PB purposes — not a course segment itself).
export const RACE_STATIONS = HYROX_STATIONS.slice(1);

export type SegmentType = 'run' | 'station' | 'roxzone';

export type SplitDraft = {
  segmentType: SegmentType;
  segmentIndex: number; // 1-8, lap number
  stationKey?: string; // set only for segmentType === 'station'
  seconds: number | null;
};

// One row per lap segment, in the order a lap is actually run:
// run, roxzone (run-to-station transition), station.
export function emptyRaceSplits(): SplitDraft[] {
  const splits: SplitDraft[] = [];
  for (let i = 1; i <= 8; i++) {
    splits.push({ segmentType: 'run', segmentIndex: i, seconds: null });
    splits.push({ segmentType: 'roxzone', segmentIndex: i, seconds: null });
    splits.push({
      segmentType: 'station',
      segmentIndex: i,
      stationKey: RACE_STATIONS[i - 1].key,
      seconds: null,
    });
  }
  return splits;
}

export function sumSeconds(values: (number | null)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function allSplitsFilled(splits: SplitDraft[]): boolean {
  return splits.every((s) => s.seconds != null && s.seconds >= 0);
}

export type RaceTotals = {
  runTotalSeconds: number;
  stationTotalSeconds: number;
  roxzoneTotalSeconds: number;
  totalSeconds: number;
};

export function computeRaceTotals(splits: SplitDraft[]): RaceTotals {
  const byType = (t: SegmentType) =>
    sumSeconds(splits.filter((s) => s.segmentType === t).map((s) => s.seconds));
  const runTotalSeconds = byType('run');
  const stationTotalSeconds = byType('station');
  const roxzoneTotalSeconds = byType('roxzone');
  return {
    runTotalSeconds,
    stationTotalSeconds,
    roxzoneTotalSeconds,
    totalSeconds: runTotalSeconds + stationTotalSeconds + roxzoneTotalSeconds,
  };
}
