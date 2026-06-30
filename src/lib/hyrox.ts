// The Hyrox Track catalog — what a gym on the 'hyrox' discipline sees
// in /track instead of the CrossFit movement groups.
//
// Hyrox is a fixed race: 8 × 1 km runs interleaved with 8 functional
// stations, in a set order. So unlike the open-ended CrossFit catalog,
// this is a short, ordered list of *benchmarks* — each station has one
// natural personal-best scheme (the time to finish its standard
// distance / rep count), plus the 1 km run split and the full / half
// race simulation.
//
// Station keys are persisted in tracked_movement_results.movement_key
// (same table as CrossFit logs) — never rename them without a data
// migration. They're namespaced `hyrox_*` so they never collide with a
// CrossFit movement key, which lets the shared finders resolve both
// catalogs from one combined registry.

import type { Movement, MovementGroup, Scheme } from './movements';

// Every Hyrox benchmark is "time to complete the standard work" —
// faster is better.
const STATION_TIME = (key: string, label: string): Scheme => ({
  key,
  label,
  metric: 'time',
  better: 'lower',
});

export type HyroxStation = {
  // movement key + the single PB scheme key it logs against.
  key: string;
  schemeKey: string;
  name: string;
  // The standard race work, e.g. "1000 m" / "50 m" / "100 reps" —
  // shown under the station name on the Track grid.
  spec: string;
  icon: string;
  accent: string;
  scheme: Scheme;
};

const station = (
  key: string,
  name: string,
  spec: string,
  schemeKey: string,
  icon: string,
  accent: string,
): HyroxStation => ({
  key,
  schemeKey,
  name,
  spec,
  icon,
  accent,
  scheme: STATION_TIME(schemeKey, spec),
});

// In race order: the 1 km run split leads, then the eight stations as
// they appear on course.
export const HYROX_STATIONS: HyroxStation[] = [
  station('hyrox_run', 'Run', '1 km', '1km', 'walk-outline', '#3B82F6'),
  station('hyrox_ski_erg', 'SkiErg', '1000 m', '1000m', 'snow-outline', '#06B6D4'),
  station('hyrox_sled_push', 'Sled Push', '50 m', '50m', 'arrow-forward-circle-outline', '#EF4444'),
  station('hyrox_sled_pull', 'Sled Pull', '50 m', '50m', 'arrow-back-circle-outline', '#F59E0B'),
  station('hyrox_burpee_broad_jump', 'Burpee Broad Jumps', '80 m', '80m', 'body-outline', '#8B5CF6'),
  station('hyrox_row', 'Row', '1000 m', '1000m', 'boat-outline', '#10B981'),
  station('hyrox_farmers_carry', 'Farmers Carry', '200 m', '200m', 'barbell-outline', '#F97316'),
  station('hyrox_sandbag_lunge', 'Sandbag Lunges', '100 m', '100m', 'fitness-outline', '#EC4899'),
  station('hyrox_wall_balls', 'Wall Balls', '100 reps', '100reps', 'ellipse-outline', '#14B8A6'),
];

// The full-race simulation tile. Phase 1 logs a single finish time per
// format (full / half); the split-by-split simulation builder is the
// scaffolded next phase.
export const HYROX_SIM = {
  key: 'hyrox_sim',
  name: 'Race Simulation',
  spec: '8 runs · 8 stations',
  icon: 'flag-outline',
  accent: '#2563EB',
  schemes: [
    STATION_TIME('full', 'Full Hyrox'),
    STATION_TIME('half', 'Half Hyrox'),
  ] as Scheme[],
};

// Your official competition result — the finish time you posted at a
// real Hyrox race. Kept separate from the training Race Simulation so
// PBs and leaderboards reflect actual races, not practice runs. Same
// full / half formats; scheme keys are scoped to this movement key, so
// they don't collide with HYROX_SIM's identically-named schemes.
export const HYROX_TIME = {
  key: 'hyrox_time',
  name: 'Hyrox Time',
  spec: 'Official race result',
  icon: 'stopwatch-outline',
  accent: '#DC2626',
  schemes: [
    STATION_TIME('full', 'Full Hyrox'),
    STATION_TIME('half', 'Half Hyrox'),
  ] as Scheme[],
};

const asMovement = (s: HyroxStation): Movement => ({
  key: s.key,
  name: s.name,
  schemes: [s.scheme],
});

// The catalog shape the shared Track surfaces (group page, recorder
// picker, finders) consume — same MovementGroup contract as the
// CrossFit catalog.
export const HYROX_GROUPS: MovementGroup[] = [
  {
    key: 'hyrox_stations',
    name: 'Hyrox Stations',
    blurb: 'The eight stations and the 1 km run split.',
    icon: 'flame-outline',
    accent: '#2563EB',
    movements: HYROX_STATIONS.map(asMovement),
  },
  {
    key: 'hyrox_race',
    name: 'Race',
    blurb: 'Race simulations and official times.',
    icon: 'flag-outline',
    accent: '#7C3AED',
    movements: [
      { key: HYROX_SIM.key, name: HYROX_SIM.name, schemes: HYROX_SIM.schemes },
      { key: HYROX_TIME.key, name: HYROX_TIME.name, schemes: HYROX_TIME.schemes },
    ],
  },
];

// Headline benchmarks for the Hyrox leaderboards index — every station
// plus the full sim, each on its single PB scheme.
export const HYROX_BENCHMARKS: { movementKey: string; schemeKey: string }[] = [
  ...HYROX_STATIONS.map((s) => ({ movementKey: s.key, schemeKey: s.schemeKey })),
  { movementKey: HYROX_SIM.key, schemeKey: 'full' },
  { movementKey: HYROX_TIME.key, schemeKey: 'full' },
];
