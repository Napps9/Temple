// Static catalog of trackable movements, grouped by category. The
// shape mirrors what the member sees in /track: a category page lists
// movements; a movement page lists the schemes (1RM, 5K time, ...)
// and surfaces a member's best for each.
//
// The keys (group / movement / scheme) are persisted in
// tracked_movement_results — never rename them without a data
// migration. Display labels can change freely.

export type Metric = 'weight' | 'time' | 'reps' | 'calories' | 'distance';

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
};

export type MovementGroup = {
  key: string;
  name: string;
  // Short description shown on the category card.
  blurb: string;
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
    movements: [
      {
        key: 'back_squat',
        name: 'Back Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
      },
      {
        key: 'front_squat',
        name: 'Front Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
      },
      {
        key: 'overhead_squat',
        name: 'Overhead Squat',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
      },
    ],
  },
  {
    key: 'pushing',
    name: 'Pushing',
    blurb: 'Presses, jerks, bench, and thrusters.',
    movements: [
      {
        key: 'push_press',
        name: 'Push Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'strict_press',
        name: 'Strict Press (Shoulder Press)',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'shoulder_to_overhead',
        name: 'Shoulder-to-Overhead (Push Jerk)',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'bench_press',
        name: 'Bench Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'split_jerk',
        name: 'Split Jerk',
        schemes: [REP_MAX(1), REP_MAX(3)],
      },
      {
        key: 'thruster',
        name: 'Thruster',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5), REP_MAX(10)],
      },
    ],
  },
  {
    key: 'pulling',
    name: 'Pulling',
    blurb: 'Deadlift and pulling variations.',
    movements: [
      {
        key: 'deadlift',
        name: 'Deadlift',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
    ],
  },
  {
    key: 'cleans',
    name: 'Cleans',
    blurb: 'Squat, hang, and power clean variations.',
    movements: [
      {
        key: 'squat_clean',
        name: 'Squat Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'hang_clean',
        name: 'Hang Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'power_clean',
        name: 'Power Clean',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
    ],
  },
  {
    key: 'snatch',
    name: 'Snatch',
    blurb: 'Squat, hang, power, and accessory variations.',
    movements: [
      {
        key: 'squat_snatch',
        name: 'Squat Snatch',
        schemes: [REP_MAX(1)],
      },
      {
        key: 'hang_snatch',
        name: 'Hang Snatch',
        schemes: [REP_MAX(1), REP_MAX(3)],
      },
      {
        key: 'power_snatch',
        name: 'Power Snatch',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
      {
        key: 'snatch_balance',
        name: 'Snatch Balance',
        schemes: [REP_MAX(1)],
      },
      {
        key: 'sots_press',
        name: 'Sots Press',
        schemes: [REP_MAX(1), REP_MAX(3), REP_MAX(5)],
      },
    ],
  },
  {
    key: 'aerobic',
    name: 'Aerobic Conditioning',
    blurb: 'Running, rowing, biking, and ski erg benchmarks.',
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
      },
    ],
  },
  {
    key: 'bodyweight',
    name: 'Bodyweight Movements',
    blurb: 'Pull ups, toes to bar, HSPU, handstand walks and holds.',
    movements: [
      {
        key: 'strict_pull_ups',
        name: 'Strict Pull Ups',
        schemes: [MAX_REPS],
      },
      {
        key: 'kipping_pull_up',
        name: 'Kipping / Butterfly Pull Up',
        schemes: [MAX_REPS],
      },
      {
        key: 'strict_toes_to_bar',
        name: 'Strict Toes to Bar',
        schemes: [MAX_REPS],
      },
      {
        key: 'kipping_toes_to_bar',
        name: 'Kipping Toes to Bar',
        schemes: [MAX_REPS],
      },
      {
        key: 'strict_hspu',
        name: 'Strict Handstand Push Ups',
        schemes: [MAX_REPS],
      },
      {
        key: 'kipping_hspu',
        name: 'Kipping Handstand Push Ups',
        schemes: [MAX_REPS],
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
      },
    ],
  },
];

export function findGroup(groupKey: string): MovementGroup | undefined {
  return MOVEMENT_GROUPS.find((g) => g.key === groupKey);
}

export function findMovement(
  movementKey: string,
): { group: MovementGroup; movement: Movement } | undefined {
  for (const group of MOVEMENT_GROUPS) {
    const movement = group.movements.find((m) => m.key === movementKey);
    if (movement) return { group, movement };
  }
  return undefined;
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

export function allSchemeOptions(): SchemeOption[] {
  const out: SchemeOption[] = [];
  for (const group of MOVEMENT_GROUPS) {
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
