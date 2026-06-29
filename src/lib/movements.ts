// Static catalog of trackable movements, grouped by category. The
// shape mirrors what the member sees in /track: a category page lists
// movements; a movement page lists the schemes (1RM, 5K time, ...)
// and surfaces a member's best for each.
//
// The keys (group / movement / scheme) are persisted in
// tracked_movement_results — never rename them without a data
// migration. Display labels can change freely.

import { HYROX_GROUPS } from './hyrox';

export type Metric = 'weight' | 'time' | 'reps' | 'calories' | 'distance';

// A gym's Track flavour. Drives which catalog the member sees; the
// underlying tracked_* tables are shared (keys are namespaced so the
// two catalogs never collide).
export type Discipline = 'crossfit' | 'hyrox';

export type Scheme = {
  key: string;
  label: string;
  metric: Metric;
  // Whether a higher value is "better" (used to pick the personal best
  // from a series of results). Heavier weight, more reps, more cals,
  // farther distance — better. Faster time — better at lower.
  better: 'higher' | 'lower';
};

export type Movement = {
  key: string;
  name: string;
  schemes: Scheme[];
  // Lower-case substrings that, when found in a programmed body,
  // identify *this specific movement*. Bare-ambiguous terms like
  // "squat" / "press" / "snatch" are intentionally NOT registered as
  // aliases of any movement — the detector skips ambiguous matches
  // and lets the member pick.
  aliases?: string[];
};

export type MovementGroup = {
  key: string;
  name: string;
  // Short description shown on the category card.
  blurb: string;
  // Ionicons name + accent hex; renderers cast the icon to
  // keyof typeof Ionicons.glyphMap. Kept as plain strings here so
  // this module stays free of React Native imports.
  icon: string;
  accent: string;
  movements: Movement[];
};

const REP_MAX = (reps: number): Scheme => ({
  key: `${reps}rm`,
  label: `${reps} Rep Max`,
  metric: 'weight',
  better: 'higher',
});

const RUN_TIME = (key: string, label: string): Scheme => ({
  key,
  label,
  metric: 'time',
  better: 'lower',
});

const ROW_TEST = (meters: number, label: string): Scheme => ({
  key: `${meters}m`,
  label,
  metric: 'time',
  better: 'lower',
});

const MAX_CAL = (minutes: number): Scheme => ({
  key: `${minutes}min_max_cal`,
  label: `${minutes}-Minute Max Calories`,
  metric: 'calories',
  better: 'higher',
});

const MAX_REPS: Scheme = {
  key: 'max_reps',
  label: 'Max Reps',
  metric: 'reps',
  better: 'higher',
};

export const MOVEMENT_GROUPS: MovementGroup[] = [
  {
    key: 'squats',
    name: 'Squats',
    blurb: 'Back, front, and overhead variations.',
    icon: 'barbell-outline',
    accent: '#3B82F6',
    movements: [
      {
        key: 'back_squat',
        name: 'Back Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
        aliases: ['back squat', 'back squats'],
      },
      {
        key: 'front_squat',
        name: 'Front Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
        aliases: ['front squat', 'front squats'],
      },
      {
        key: 'overhead_squat',
        name: 'Overhead Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
        aliases: ['overhead squat', 'overhead squats', 'ohs'],
      },
      {
        key: 'air_squat',
        name: 'Air Squat',
        schemes: [MAX_REPS],
        aliases: ['air squat', 'air squats', 'bodyweight squat'],
      },
      {
        key: 'wall_ball',
        name: 'Wall Ball',
        schemes: [MAX_REPS],
        aliases: ['wall ball', 'wall balls', 'wb'],
      },
      {
        key: 'goblet_squat',
        name: 'Goblet Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
        aliases: ['goblet squat', 'goblet squats'],
      },
      {
        key: 'pistol_squat',
        name: 'Pistol Squat',
        schemes: [MAX_REPS],
        aliases: ['pistol squat', 'pistol squats', 'pistols'],
      },
      {
        key: 'lunge',
        name: 'Lunge',
        schemes: [MAX_REPS],
        aliases: ['lunge', 'lunges', 'walking lunge', 'walking lunges'],
      },
    ],
  },
  {
    key: 'pushing',
    name: 'Pushing',
    blurb: 'Presses, jerks, bench, and thrusters.',
    icon: 'arrow-up-circle-outline',
    accent: '#EF4444',
    movements: [
      {
        key: 'push_press',
        name: 'Push Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['push press', 'push presses'],
      },
      {
        key: 'strict_press',
        name: 'Strict Press (Shoulder Press)',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: [
          'strict press',
          'shoulder press',
          'strict shoulder press',
          'military press',
        ],
      },
      {
        key: 'shoulder_to_overhead',
        name: 'Shoulder-to-Overhead (Push Jerk)',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: [
          'shoulder to overhead',
          'shoulder-to-overhead',
          'push jerk',
          's2oh',
        ],
      },
      {
        key: 'bench_press',
        name: 'Bench Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['bench press', 'bench presses'],
      },
      {
        key: 'split_jerk',
        name: 'Split Jerk',
        schemes: [REP_MAX(1), REP_MAX(3)],
        aliases: ['split jerk', 'split jerks'],
      },
      {
        key: 'thruster',
        name: 'Thruster',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
        aliases: ['thruster', 'thrusters'],
      },
      {
        key: 'dumbbell_press',
        name: 'Dumbbell Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: [
          'dumbbell press',
          'dumbbell shoulder press',
          'db press',
          'db shoulder press',
        ],
      },
      {
        key: 'push_up',
        name: 'Push Up',
        schemes: [MAX_REPS],
        aliases: ['push up', 'push ups', 'push-up', 'push-ups', 'pushup', 'pushups'],
      },
    ],
  },
  {
    key: 'pulling',
    name: 'Pulling',
    blurb: 'Deadlift and pulling variations.',
    icon: 'fitness-outline',
    accent: '#F59E0B',
    movements: [
      {
        key: 'deadlift',
        name: 'Deadlift',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['deadlift', 'deadlifts', 'conventional deadlift'],
      },
      {
        key: 'sumo_deadlift',
        name: 'Sumo Deadlift',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['sumo deadlift', 'sumo deadlifts'],
      },
      {
        key: 'romanian_deadlift',
        name: 'Romanian Deadlift',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['romanian deadlift', 'romanian deadlifts', 'rdl', 'rdls'],
      },
      {
        key: 'kettlebell_swing',
        name: 'Kettlebell Swing',
        schemes: [MAX_REPS],
        aliases: [
          'kettlebell swing',
          'kettlebell swings',
          'kb swing',
          'kb swings',
        ],
      },
      {
        key: 'bent_over_row',
        name: 'Bent Over Row',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['bent over row', 'bent over rows', 'barbell row', 'barbell rows'],
      },
    ],
  },
  {
    key: 'cleans',
    name: 'Cleans',
    blurb: 'Squat, hang, and power clean variations.',
    icon: 'flash-outline',
    accent: '#10B981',
    movements: [
      {
        key: 'squat_clean',
        name: 'Squat Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['squat clean', 'squat cleans'],
      },
      {
        key: 'hang_clean',
        name: 'Hang Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['hang clean', 'hang cleans'],
      },
      {
        key: 'power_clean',
        name: 'Power Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['power clean', 'power cleans'],
      },
    ],
  },
  {
    key: 'snatch',
    name: 'Snatch',
    blurb: 'Squat, hang, power, and accessory variations.',
    icon: 'rocket-outline',
    accent: '#8B5CF6',
    movements: [
      {
        key: 'squat_snatch',
        name: 'Squat Snatch',
        schemes: [REP_MAX(1)],
        aliases: ['squat snatch', 'squat snatches'],
      },
      {
        key: 'hang_snatch',
        name: 'Hang Snatch',
        schemes: [REP_MAX(1), REP_MAX(3)],
        aliases: ['hang snatch', 'hang snatches'],
      },
      {
        key: 'power_snatch',
        name: 'Power Snatch',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['power snatch', 'power snatches'],
      },
      {
        key: 'snatch_balance',
        name: 'Snatch Balance',
        schemes: [REP_MAX(1)],
        aliases: ['snatch balance'],
      },
      {
        key: 'sots_press',
        name: 'Sots Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
        aliases: ['sots press', 'sots presses'],
      },
    ],
  },
  {
    key: 'aerobic',
    name: 'Aerobic Conditioning',
    blurb: 'Running, rowing, biking, and ski erg benchmarks.',
    icon: 'pulse-outline',
    accent: '#EC4899',
    movements: [
      {
        key: 'running',
        name: 'Running',
        schemes: [
          RUN_TIME('1mi', '1-Mile Time'),
          RUN_TIME('5k', '5K Time'),
          RUN_TIME('10k', '10K Time'),
          RUN_TIME('half_marathon', 'Half Marathon Time'),
          RUN_TIME('marathon', 'Marathon Time'),
        ],
        aliases: ['running', 'run'],
      },
      {
        key: 'assault_bike',
        name: 'Air Biking / Assault Biking',
        schemes: [
          MAX_CAL(5),
          MAX_CAL(20),
          {
            key: 'death_by_bike',
            label: 'Death By Assault Bike',
            metric: 'reps',
            better: 'higher',
          },
          {
            key: '50_cal_time_trial',
            label: '50-Calorie Time Trial',
            metric: 'time',
            better: 'lower',
          },
        ],
        aliases: ['assault bike', 'air bike', 'echo bike', 'air biking'],
      },
      {
        key: 'rowing',
        name: 'Rowing',
        schemes: [
          ROW_TEST(500, '500-Meter Test'),
          ROW_TEST(2000, '2,000-Meter Test'),
          ROW_TEST(5000, '5,000-Meter Test'),
          {
            key: '30min_test',
            label: '30-Minute Test',
            metric: 'distance',
            better: 'higher',
          },
        ],
        aliases: ['rowing', 'row', 'erg row'],
      },
      {
        key: 'ski_erg',
        name: 'Ski Erg',
        schemes: [
          ROW_TEST(500, '500-Meter Test'),
          ROW_TEST(2000, '2,000-Meter Test'),
          ROW_TEST(5000, '5,000-Meter Test'),
          {
            key: '30min_test',
            label: '30-Minute Test',
            metric: 'distance',
            better: 'higher',
          },
        ],
        aliases: ['ski erg', 'ski-erg', 'skierg'],
      },
      {
        key: 'mikko_triangle',
        name: 'Mikko Triangle',
        schemes: [
          {
            key: 'total_cal',
            label: 'Total Calories',
            metric: 'calories',
            better: 'higher',
          },
        ],
        aliases: ['mikko triangle'],
      },
    ],
  },
  {
    key: 'bodyweight',
    name: 'Bodyweight Movements',
    blurb: 'Pull ups, toes to bar, HSPU, handstand walks and holds.',
    icon: 'body-outline',
    accent: '#06B6D4',
    movements: [
      {
        key: 'strict_pull_ups',
        name: 'Strict Pull Ups',
        schemes: [MAX_REPS],
        aliases: ['strict pull up', 'strict pull ups', 'strict pull-up', 'strict pull-ups'],
      },
      {
        key: 'kipping_pull_up',
        name: 'Kipping / Butterfly Pull Up',
        schemes: [MAX_REPS],
        // "pull up" alone defaults to kipping per CrossFit convention;
        // "strict pull up" is a more specific alias on the strict
        // movement and wins by longest-match.
        aliases: [
          'kipping pull up',
          'kipping pull ups',
          'butterfly pull up',
          'butterfly pull ups',
          'pull up',
          'pull ups',
          'pull-up',
          'pull-ups',
          'pullup',
          'pullups',
        ],
      },
      {
        key: 'strict_toes_to_bar',
        name: 'Strict Toes to Bar',
        schemes: [MAX_REPS],
        aliases: ['strict toes to bar', 'strict t2b'],
      },
      {
        key: 'kipping_toes_to_bar',
        name: 'Kipping Toes to Bar',
        schemes: [MAX_REPS],
        aliases: ['kipping toes to bar', 'toes to bar', 't2b', 'ttb'],
      },
      {
        key: 'strict_hspu',
        name: 'Strict Handstand Push Ups',
        schemes: [MAX_REPS],
        aliases: [
          'strict handstand push up',
          'strict handstand push ups',
          'strict hspu',
        ],
      },
      {
        key: 'kipping_hspu',
        name: 'Kipping Handstand Push Ups',
        schemes: [MAX_REPS],
        aliases: [
          'kipping handstand push up',
          'kipping handstand push ups',
          'kipping hspu',
          'handstand push up',
          'handstand push ups',
          'hspu',
        ],
      },
      {
        key: 'handstand_walks',
        name: 'Handstand Walks',
        schemes: [
          {
            key: 'max_distance',
            label: 'Max Distance',
            metric: 'distance',
            better: 'higher',
          },
        ],
        aliases: ['handstand walk', 'handstand walks', 'hs walk'],
      },
      {
        key: 'handstand_holds',
        name: 'Handstand Holds',
        schemes: [
          {
            key: 'max_time',
            label: 'Max Time',
            metric: 'time',
            better: 'higher',
          },
        ],
        aliases: ['handstand hold', 'handstand holds'],
      },
      {
        key: 'burpee',
        name: 'Burpee',
        schemes: [MAX_REPS],
        aliases: [
          'burpee',
          'burpees',
          'burpee over bar',
          'burpees over bar',
          'bar facing burpee',
          'bar facing burpees',
        ],
      },
      {
        key: 'box_jump',
        name: 'Box Jump',
        schemes: [MAX_REPS],
        aliases: ['box jump', 'box jumps', 'box jump over', 'box jump overs'],
      },
      {
        key: 'box_step_up',
        name: 'Box Step Up',
        schemes: [MAX_REPS],
        aliases: ['box step up', 'box step ups', 'step up', 'step ups'],
      },
      {
        key: 'sit_up',
        name: 'Sit Up',
        schemes: [MAX_REPS],
        aliases: ['sit up', 'sit ups', 'sit-up', 'sit-ups', 'situp', 'situps'],
      },
      {
        key: 'plank_hold',
        name: 'Plank Hold',
        schemes: [
          {
            key: 'max_time',
            label: 'Max Time',
            metric: 'time',
            better: 'higher',
          },
        ],
        aliases: ['plank hold', 'plank holds', 'plank'],
      },
      {
        key: 'hollow_hold',
        name: 'Hollow Hold',
        schemes: [
          {
            key: 'max_time',
            label: 'Max Time',
            metric: 'time',
            better: 'higher',
          },
        ],
        aliases: ['hollow hold', 'hollow holds', 'hollow body hold'],
      },
      {
        key: 'l_sit_hold',
        name: 'L-Sit Hold',
        schemes: [
          {
            key: 'max_time',
            label: 'Max Time',
            metric: 'time',
            better: 'higher',
          },
        ],
        aliases: ['l sit', 'l-sit', 'l sit hold', 'l-sit hold'],
      },
      {
        key: 'double_under',
        name: 'Double Under',
        schemes: [MAX_REPS],
        aliases: ['double under', 'double unders', 'dus', 'du'],
      },
      {
        key: 'single_under',
        name: 'Single Under',
        schemes: [MAX_REPS],
        aliases: ['single under', 'single unders', 'jump rope'],
      },
    ],
  },
];

// Every group across every discipline. The finders below resolve over
// this combined registry so a shared surface (movement detail, the
// recorder, leaderboards) works for a key from either catalog without
// having to know the gym's discipline — keys are namespaced, so the
// union is unambiguous.
const ALL_GROUPS: MovementGroup[] = [...MOVEMENT_GROUPS, ...HYROX_GROUPS];

// The catalog a given discipline shows in its own Track surfaces (home
// grid, recorder picker). CrossFit gyms see the movement groups; Hyrox
// gyms see the stations + race.
export function catalogGroups(discipline: Discipline): MovementGroup[] {
  return discipline === 'hyrox' ? HYROX_GROUPS : MOVEMENT_GROUPS;
}

export function findGroup(groupKey: string): MovementGroup | undefined {
  return ALL_GROUPS.find((g) => g.key === groupKey);
}

export function findMovement(
  movementKey: string,
): { group: MovementGroup; movement: Movement } | undefined {
  for (const group of ALL_GROUPS) {
    const movement = group.movements.find((m) => m.key === movementKey);
    if (movement) return { group, movement };
  }
  return undefined;
}

export function movementName(movementKey: string): string {
  return findMovement(movementKey)?.movement.name ?? movementKey;
}

export function findScheme(
  movementKey: string,
  schemeKey: string,
): Scheme | undefined {
  const found = findMovement(movementKey);
  return found?.movement.schemes.find((s) => s.key === schemeKey);
}

// Flat list of every (movement, scheme) pair — used by the record form's
// picker so members can pick a scheme directly.
export type SchemeOption = {
  groupKey: string;
  groupName: string;
  movementKey: string;
  movementName: string;
  schemeKey: string;
  schemeLabel: string;
  metric: Metric;
  better: 'higher' | 'lower';
};

export function allSchemeOptions(
  discipline: Discipline = 'crossfit',
): SchemeOption[] {
  const out: SchemeOption[] = [];
  for (const group of catalogGroups(discipline)) {
    for (const movement of group.movements) {
      for (const scheme of movement.schemes) {
        out.push({
          groupKey: group.key,
          groupName: group.name,
          movementKey: movement.key,
          movementName: movement.name,
          schemeKey: scheme.key,
          schemeLabel: scheme.label,
          metric: scheme.metric,
          better: scheme.better,
        });
      }
    }
  }
  return out;
}
