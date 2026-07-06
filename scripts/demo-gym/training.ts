// Workout-history generation for the seeder. Movement and scheme keys
// come straight from the live catalog, so every seeded row resolves on
// the Track surfaces without inventing a single key.

import { MOVEMENT_GROUPS, type Metric } from '../../src/lib/movements';
import { HYROX_SIM, HYROX_STATIONS, HYROX_TIME } from '../../src/lib/hyrox';
import { computeRaceTotals, emptyRaceSplits, type SplitDraft } from '../../src/lib/hyrox-race';
import { rngInt, type Rng } from './roster';

export type FocusScheme = {
  movementKey: string;
  trackKey: string;
  metric: Metric;
  better: 'higher' | 'lower';
};

// Weight-metric schemes (plus a couple of timed ones) drawn from the
// real catalog in stable order — the pool every member's focus
// movements are picked from.
export function focusPool(): FocusScheme[] {
  const pool: FocusScheme[] = [];
  for (const group of MOVEMENT_GROUPS) {
    for (const movement of group.movements) {
      for (const scheme of movement.schemes) {
        if (scheme.metric === 'weight' && scheme.key === '1rm') {
          pool.push({ movementKey: movement.key, trackKey: scheme.key, metric: scheme.metric, better: scheme.better });
        }
        if (scheme.metric === 'time' && pool.filter((p) => p.metric === 'time').length < 4) {
          pool.push({ movementKey: movement.key, trackKey: scheme.key, metric: scheme.metric, better: scheme.better });
        }
      }
    }
  }
  return pool;
}

// Hyrox counterpart to focusPool() above: the eight stations plus the
// 1km run split, every one a lower-is-better time — so a Hyrox-
// discipline member's "focus movements" are drawn from race stations
// instead of barbell lifts.
export function focusPoolHyrox(): FocusScheme[] {
  return HYROX_STATIONS.map((s) => ({
    movementKey: s.key,
    trackKey: s.schemeKey,
    metric: 'time' as const,
    better: 'lower' as const,
  }));
}

// A progressing series: weights trend up with plateaus and end on a
// genuine PR; times trend down. One value per logged session.
export function progressionSeries(rng: Rng, focus: FocusScheme, count: number): number[] {
  const out: number[] = [];
  if (focus.metric === 'weight') {
    let value = rngInt(rng, 12, 32) * 2.5; // 30–80kg start, plate-friendly
    for (let i = 0; i < count; i++) {
      out.push(value);
      const roll = rng();
      if (roll > 0.55) value += 2.5;
      else if (roll > 0.35) value += 5;
      // else plateau
    }
    // Guarantee the final session is the all-time best so the PR badge
    // reads as recent.
    out[count - 1] = Math.max(...out) + 2.5;
  } else {
    let value = rngInt(rng, 1200, 1800); // seconds
    for (let i = 0; i < count; i++) {
      out.push(value);
      const roll = rng();
      if (roll > 0.5) value -= rngInt(rng, 5, 25);
    }
    out[count - 1] = Math.min(...out) - rngInt(rng, 5, 15);
  }
  return out;
}

const STATION_SECONDS: Record<string, [number, number]> = {
  hyrox_ski_erg: [210, 300],
  hyrox_sled_push: [120, 260],
  hyrox_sled_pull: [180, 320],
  hyrox_burpee_broad_jump: [180, 340],
  hyrox_row: [220, 310],
  hyrox_farmers_carry: [70, 150],
  hyrox_sandbag_lunge: [180, 330],
  hyrox_wall_balls: [240, 420],
};

export type DemoRace = {
  raceLength: 'full' | 'half';
  genderCategory: 'mens' | 'womens' | 'mixed';
  splits: SplitDraft[];
  runTotalSeconds: number;
  stationTotalSeconds: number;
  roxzoneTotalSeconds: number;
  totalSeconds: number;
};

export function buildRace(
  rng: Rng,
  raceLength: 'full' | 'half',
  genderCategory: 'mens' | 'womens',
): DemoRace {
  const scale = raceLength === 'half' ? 0.5 : 1;
  const splits = emptyRaceSplits().map((s) => {
    let seconds: number;
    if (s.segmentType === 'run') seconds = rngInt(rng, 250, 380);
    else if (s.segmentType === 'roxzone') seconds = rngInt(rng, 40, 95);
    else {
      const [lo, hi] = STATION_SECONDS[s.stationKey ?? ''] ?? [120, 300];
      seconds = rngInt(rng, lo, hi);
    }
    return { ...s, seconds: Math.round(seconds * scale) };
  });
  const totals = computeRaceTotals(splits);
  return {
    raceLength,
    genderCategory,
    splits,
    runTotalSeconds: totals.runTotalSeconds,
    stationTotalSeconds: totals.stationTotalSeconds,
    roxzoneTotalSeconds: totals.roxzoneTotalSeconds,
    totalSeconds: totals.totalSeconds,
  };
}

// The single tracked_movement_results row logged alongside a race —
// 0096's contract: PR badges and leaderboards read this row, the
// splits table is the detail underneath it.
export const HYROX_SIM_MOVEMENT_KEY = HYROX_SIM.key;

// A real competition result, logged separately from the training
// Race Simulation above (see hyrox.ts: HYROX_TIME vs HYROX_SIM) — no
// split breakdown, just the finish time.
export const HYROX_TIME_MOVEMENT_KEY = HYROX_TIME.key;

// Plausible official finish times in seconds — wide enough to look
// like real racers, not a rounded demo number.
export function officialRaceSeconds(rng: Rng, raceLength: 'full' | 'half'): number {
  return raceLength === 'full' ? rngInt(rng, 4800, 6600) : rngInt(rng, 2700, 3900);
}
