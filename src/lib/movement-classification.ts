// Movement classification — pure, hand-authored. Every key in
// MOVEMENT_GROUPS (src/lib/movements.ts) has one entry here so the
// Programming Analysis page can group, count, and heat-map movements
// across three axes:
//
//   • pattern (squat / hinge / push / pull / olympic / gait / ...)
//   • energy_systems (phosphagen / glycolytic / oxidative)
//   • primary_regions (body region keys reused from BODY_REGIONS so
//     injuries and programming both light up the same silhouette)
//
// `pattern` is the way a coach would programme the lift — a thruster
// is fundamentally a squat-driven press, so its `pattern` is `squat`
// and the press is captured by `secondary: 'vertical_push'`. A handful
// of CrossFit staples sit naturally in two patterns (thruster, wall
// ball, burpee, handstand walk, box jump); leave `secondary` undefined
// when one pattern carries the move.
//
// `energy_systems` reflects how the lift is *typically* trained, not
// the metabolic ceiling. A back squat done as a 1RM is phosphagen;
// done in a 21-15-9 it pushes glycolytic — but the format already
// signals that, and FORMAT_ENERGY_BIAS combines with this table inside
// classifyProgrammedSection. Movements that almost always run as
// metcon work (wall ball, KB swing, burpees) carry glycolytic here.
//
// `primary_regions` uses BODY_REGIONS keys from src/lib/injuries.ts.
// 1–3 entries; the heaviest mover comes first.

import type { SectionFormatKey } from './programming';

export type EnergySystem = 'phosphagen' | 'glycolytic' | 'oxidative';

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'olympic'
  | 'gait'
  | 'monostructural'
  | 'core'
  | 'gymnastic_static'
  | 'carry';

export type Dominance = 'anterior' | 'posterior' | 'mixed' | 'na';

export type MovementClassification = {
  pattern: MovementPattern;
  secondary?: MovementPattern;
  energy_systems: EnergySystem[];
  primary_regions: string[];
  dominance: Dominance;
};

export const ENERGY_SYSTEMS: readonly EnergySystem[] = [
  'phosphagen',
  'glycolytic',
  'oxidative',
] as const;

export const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'olympic',
  'gait',
  'monostructural',
  'core',
  'gymnastic_static',
  'carry',
] as const;

// Display labels and the visual language used by the Analysis page.

export const PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
  olympic: 'Olympic',
  gait: 'Gait',
  monostructural: 'Monostructural',
  core: 'Core',
  gymnastic_static: 'Gymnastic hold',
  carry: 'Carry',
};

// Short labels for tight grids on mobile where the full label would
// either wrap or push the matrix cells too narrow to be useful.
export const PATTERN_LABELS_SHORT: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  horizontal_push: 'H-Push',
  vertical_push: 'V-Push',
  horizontal_pull: 'H-Pull',
  vertical_pull: 'V-Pull',
  olympic: 'Olympic',
  gait: 'Gait',
  monostructural: 'Mono',
  core: 'Core',
  gymnastic_static: 'Hold',
  carry: 'Carry',
};

export const ENERGY_LABELS: Record<EnergySystem, string> = {
  phosphagen: 'Phosphagen',
  glycolytic: 'Glycolytic',
  oxidative: 'Oxidative',
};

// 3-letter mobile headers for the matrix.
export const ENERGY_LABELS_SHORT: Record<EnergySystem, string> = {
  phosphagen: 'Phos',
  glycolytic: 'Gly',
  oxidative: 'Oxi',
};

// Cooler → hotter through the metabolic spectrum: phosphagen blue,
// glycolytic amber, oxidative emerald. Bars and headers tint with these.
export const ENERGY_COLOURS: Record<EnergySystem, string> = {
  phosphagen: '#2563EB',
  glycolytic: '#F59E0B',
  oxidative: '#10B981',
};

// Format-level energy bias. `for_time` and `amrap` default to
// glycolytic; classifyProgrammedSection upgrades them to oxidative
// when the body text hints at a duration over ~15 minutes.
export const FORMAT_ENERGY_BIAS: Record<SectionFormatKey, EnergySystem[]> = {
  strength_sets: ['phosphagen'],
  max_load: ['phosphagen'],
  emom: ['glycolytic'],
  intervals: ['glycolytic', 'oxidative'],
  max_distance: ['oxidative'],
  max_calories: ['glycolytic', 'oxidative'],
  amrap: ['glycolytic'],
  for_time: ['glycolytic'],
  no_score: [],
  other: [],
};

// Body region shortcuts so the table reads as movements first, anatomy
// second.
const QUAD_GLUTE_LB = ['quad', 'glute', 'lower_back'];
const QUAD_GLUTE_HAM = ['quad', 'glute', 'hamstring'];
const POSTERIOR_CHAIN = ['hamstring', 'glute', 'lower_back'];
const CHEST_SHOULDER_TRI = ['chest', 'shoulder', 'upper_arm'];
const SHOULDER_TRI = ['shoulder', 'upper_arm'];
const UPPER_BACK_ARMS = ['upper_back', 'upper_arm', 'forearm'];

export const MOVEMENT_CLASSIFICATIONS: Record<string, MovementClassification> =
  {
    // ---------------------------------------------------------------- Squats
    back_squat: {
      pattern: 'squat',
      energy_systems: ['phosphagen'],
      primary_regions: QUAD_GLUTE_LB,
      dominance: 'anterior',
    },
    front_squat: {
      pattern: 'squat',
      energy_systems: ['phosphagen'],
      primary_regions: ['quad', 'glute', 'upper_back'],
      dominance: 'anterior',
    },
    overhead_squat: {
      pattern: 'squat',
      energy_systems: ['phosphagen'],
      primary_regions: ['quad', 'glute', 'shoulder'],
      dominance: 'mixed',
    },
    air_squat: {
      pattern: 'squat',
      energy_systems: ['glycolytic'],
      primary_regions: ['quad', 'glute'],
      dominance: 'anterior',
    },
    wall_ball: {
      pattern: 'squat',
      secondary: 'vertical_push',
      energy_systems: ['glycolytic'],
      primary_regions: ['quad', 'glute', 'shoulder'],
      dominance: 'mixed',
    },
    goblet_squat: {
      pattern: 'squat',
      energy_systems: ['glycolytic', 'phosphagen'],
      primary_regions: QUAD_GLUTE_LB,
      dominance: 'anterior',
    },
    pistol_squat: {
      pattern: 'squat',
      energy_systems: ['glycolytic'],
      primary_regions: ['quad', 'glute', 'hip_groin'],
      dominance: 'anterior',
    },
    lunge: {
      pattern: 'squat',
      energy_systems: ['glycolytic'],
      primary_regions: QUAD_GLUTE_HAM,
      dominance: 'anterior',
    },

    // --------------------------------------------------------------- Pushing
    push_press: {
      pattern: 'vertical_push',
      energy_systems: ['phosphagen', 'glycolytic'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    strict_press: {
      pattern: 'vertical_push',
      energy_systems: ['phosphagen'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    shoulder_to_overhead: {
      pattern: 'vertical_push',
      energy_systems: ['glycolytic', 'phosphagen'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    bench_press: {
      pattern: 'horizontal_push',
      energy_systems: ['phosphagen'],
      primary_regions: CHEST_SHOULDER_TRI,
      dominance: 'anterior',
    },
    split_jerk: {
      pattern: 'vertical_push',
      secondary: 'olympic',
      energy_systems: ['phosphagen'],
      primary_regions: ['shoulder', 'upper_arm', 'quad'],
      dominance: 'mixed',
    },
    thruster: {
      pattern: 'squat',
      secondary: 'vertical_push',
      energy_systems: ['glycolytic'],
      primary_regions: ['quad', 'glute', 'shoulder'],
      dominance: 'mixed',
    },
    dumbbell_press: {
      pattern: 'vertical_push',
      energy_systems: ['phosphagen', 'glycolytic'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    push_up: {
      pattern: 'horizontal_push',
      energy_systems: ['glycolytic'],
      primary_regions: CHEST_SHOULDER_TRI,
      dominance: 'anterior',
    },

    // --------------------------------------------------------------- Pulling
    deadlift: {
      pattern: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: POSTERIOR_CHAIN,
      dominance: 'posterior',
    },
    sumo_deadlift: {
      pattern: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['glute', 'hamstring', 'lower_back'],
      dominance: 'posterior',
    },
    romanian_deadlift: {
      pattern: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: POSTERIOR_CHAIN,
      dominance: 'posterior',
    },
    kettlebell_swing: {
      pattern: 'hinge',
      energy_systems: ['glycolytic', 'oxidative'],
      primary_regions: POSTERIOR_CHAIN,
      dominance: 'posterior',
    },
    bent_over_row: {
      pattern: 'horizontal_pull',
      energy_systems: ['phosphagen'],
      primary_regions: ['upper_back', 'upper_arm', 'lower_back'],
      dominance: 'posterior',
    },

    // ---------------------------------------------------------------- Cleans
    squat_clean: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen', 'glycolytic'],
      primary_regions: ['hamstring', 'glute', 'quad', 'upper_back'],
      dominance: 'mixed',
    },
    hang_clean: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['hamstring', 'glute', 'upper_back'],
      dominance: 'mixed',
    },
    power_clean: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['hamstring', 'glute', 'upper_back'],
      dominance: 'mixed',
    },

    // --------------------------------------------------------------- Snatch
    squat_snatch: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['hamstring', 'glute', 'shoulder', 'upper_back'],
      dominance: 'mixed',
    },
    hang_snatch: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['hamstring', 'glute', 'shoulder'],
      dominance: 'mixed',
    },
    power_snatch: {
      pattern: 'olympic',
      secondary: 'hinge',
      energy_systems: ['phosphagen'],
      primary_regions: ['hamstring', 'glute', 'shoulder', 'upper_back'],
      dominance: 'mixed',
    },
    snatch_balance: {
      pattern: 'olympic',
      energy_systems: ['phosphagen'],
      primary_regions: ['shoulder', 'quad', 'upper_back'],
      dominance: 'mixed',
    },
    sots_press: {
      pattern: 'vertical_push',
      energy_systems: ['phosphagen'],
      primary_regions: ['shoulder', 'upper_back'],
      dominance: 'anterior',
    },

    // -------------------------------------------------------------- Aerobic
    running: {
      pattern: 'gait',
      energy_systems: ['oxidative'],
      primary_regions: ['quad', 'hamstring', 'calf'],
      dominance: 'mixed',
    },
    assault_bike: {
      pattern: 'monostructural',
      energy_systems: ['oxidative', 'glycolytic'],
      primary_regions: ['quad', 'hamstring', 'shoulder'],
      dominance: 'mixed',
    },
    rowing: {
      pattern: 'monostructural',
      energy_systems: ['oxidative', 'glycolytic'],
      primary_regions: ['lower_back', 'hamstring', 'upper_back'],
      dominance: 'posterior',
    },
    ski_erg: {
      pattern: 'monostructural',
      energy_systems: ['oxidative', 'glycolytic'],
      primary_regions: ['upper_back', 'abdomen', 'shoulder'],
      dominance: 'mixed',
    },
    mikko_triangle: {
      pattern: 'monostructural',
      energy_systems: ['oxidative', 'glycolytic'],
      primary_regions: ['quad', 'hamstring', 'shoulder'],
      dominance: 'mixed',
    },

    // ----------------------------------------------------------- Bodyweight
    strict_pull_ups: {
      pattern: 'vertical_pull',
      energy_systems: ['phosphagen'],
      primary_regions: UPPER_BACK_ARMS,
      dominance: 'posterior',
    },
    kipping_pull_up: {
      pattern: 'vertical_pull',
      energy_systems: ['glycolytic'],
      primary_regions: UPPER_BACK_ARMS,
      dominance: 'posterior',
    },
    strict_toes_to_bar: {
      pattern: 'core',
      energy_systems: ['phosphagen'],
      primary_regions: ['abdomen', 'hip_groin'],
      dominance: 'anterior',
    },
    kipping_toes_to_bar: {
      pattern: 'core',
      energy_systems: ['glycolytic'],
      primary_regions: ['abdomen', 'hip_groin'],
      dominance: 'anterior',
    },
    strict_hspu: {
      pattern: 'vertical_push',
      energy_systems: ['phosphagen'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    kipping_hspu: {
      pattern: 'vertical_push',
      energy_systems: ['glycolytic'],
      primary_regions: SHOULDER_TRI,
      dominance: 'anterior',
    },
    handstand_walks: {
      pattern: 'gymnastic_static',
      secondary: 'gait',
      energy_systems: ['glycolytic'],
      primary_regions: ['shoulder', 'abdomen', 'upper_arm'],
      dominance: 'mixed',
    },
    handstand_holds: {
      pattern: 'gymnastic_static',
      energy_systems: ['phosphagen'],
      primary_regions: ['shoulder', 'abdomen', 'upper_arm'],
      dominance: 'mixed',
    },
    burpee: {
      pattern: 'core',
      secondary: 'horizontal_push',
      energy_systems: ['glycolytic'],
      primary_regions: ['chest', 'quad', 'abdomen'],
      dominance: 'mixed',
    },
    box_jump: {
      pattern: 'squat',
      secondary: 'gait',
      energy_systems: ['phosphagen', 'glycolytic'],
      primary_regions: QUAD_GLUTE_HAM,
      dominance: 'mixed',
    },
    box_step_up: {
      pattern: 'squat',
      energy_systems: ['glycolytic'],
      primary_regions: QUAD_GLUTE_HAM,
      dominance: 'mixed',
    },
    sit_up: {
      pattern: 'core',
      energy_systems: ['glycolytic'],
      primary_regions: ['abdomen', 'hip_groin'],
      dominance: 'anterior',
    },
    plank_hold: {
      pattern: 'gymnastic_static',
      energy_systems: ['phosphagen'],
      primary_regions: ['abdomen', 'lower_back', 'shoulder'],
      dominance: 'mixed',
    },
    hollow_hold: {
      pattern: 'gymnastic_static',
      energy_systems: ['phosphagen'],
      primary_regions: ['abdomen', 'hip_groin'],
      dominance: 'anterior',
    },
    l_sit_hold: {
      pattern: 'gymnastic_static',
      energy_systems: ['phosphagen'],
      primary_regions: ['abdomen', 'hip_groin', 'shoulder'],
      dominance: 'anterior',
    },
    double_under: {
      pattern: 'gait',
      energy_systems: ['glycolytic'],
      primary_regions: ['calf', 'forearm'],
      dominance: 'mixed',
    },
    single_under: {
      pattern: 'gait',
      energy_systems: ['glycolytic', 'oxidative'],
      primary_regions: ['calf', 'forearm'],
      dominance: 'mixed',
    },
  };

// Own-property lookups: a bare index would resolve prototype keys
// ("toString", "constructor") to inherited functions, and callers
// validating AI-returned movement keys rely on unknown → undefined.
export function classifyMovement(
  key: string,
): MovementClassification | undefined {
  return Object.prototype.hasOwnProperty.call(MOVEMENT_CLASSIFICATIONS, key)
    ? MOVEMENT_CLASSIFICATIONS[key]
    : undefined;
}

export function patternsOf(key: string): MovementPattern[] {
  const c = classifyMovement(key);
  if (!c) return [];
  return c.secondary ? [c.pattern, c.secondary] : [c.pattern];
}
