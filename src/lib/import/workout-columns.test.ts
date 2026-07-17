import { describe, expect, it } from 'vitest';

import {
  autoDetect,
  buildResults,
  buildWorkoutRows,
  classifyScoreType,
  looksLikeScoredResults,
  matchMovement,
  parseRoundsReps,
  parseTimeToSeconds,
} from './workout-columns';

describe('autoDetect (workouts)', () => {
  it('picks email/date/movement/weight/reps from common headers', () => {
    expect(
      autoDetect(['Email', 'Workout Date', 'Movement', 'Weight (kg)', 'Reps']),
    ).toEqual(['email', 'date', 'movement', 'weight', 'reps']);
  });

  it('returns null for unknown columns', () => {
    expect(autoDetect(['Coach', 'Email'])).toEqual([null, 'email']);
  });

  it('recognises an "Event/Workout Name" column as the movement', () => {
    expect(autoDetect(['Event/Workout Name'])).toEqual(['movement']);
  });

  it('maps a "Unit" header to weight unit on header alone (no sample rows)', () => {
    expect(autoDetect(['Email', 'Date', 'Movement', 'Unit'])).toEqual([
      'email',
      'date',
      'movement',
      'unit',
    ]);
  });

  it('keeps the unit mapping when the column reads as weight units', () => {
    expect(
      autoDetect(
        ['Email', 'Date', 'Movement', 'Unit'],
        [
          ['a@x.com', '2026-05-01', 'Back Squat', 'kg'],
          ['b@x.com', '2026-05-02', 'Deadlift', 'lb'],
        ],
      ),
    ).toEqual(['email', 'date', 'movement', 'unit']);
  });

  it('declines a "Unit" column whose values are score units, not weights', () => {
    // A scored-results export: the "Unit" column holds mm:ss / rounds+reps,
    // so it must not be auto-mapped to Weight unit. Score Value maps to the
    // score_value field; only Unit is left unmapped.
    expect(
      autoDetect(
        ['Member Email', 'Date', 'Event/Workout Name', 'Score Value', 'Unit'],
        [
          ['a@x.com', '01/07/2026', 'Fran', '3:12', 'mm:ss'],
          ['b@x.com', '05/07/2026', 'Cindy', '19+7', 'rounds+reps'],
        ],
      ),
    ).toEqual(['email', 'date', 'movement', 'score_value', null]);
  });
});

describe('looksLikeScoredResults', () => {
  it('trips on times, rounds+reps and score-type keywords', () => {
    expect(
      looksLikeScoredResults([
        ['a@x.com', 'Fran', 'FOR_TIME', '3:12', 'mm:ss'],
        ['b@x.com', 'Cindy', 'FOR_ROUNDS_REPS', '19+7', 'rounds+reps'],
        ['c@x.com', 'Hyrox London', 'TIME', '1:05:10', 'h:mm:ss'],
      ]),
    ).toBe(true);
  });

  it('stays false for a plain weighted-movement log', () => {
    expect(
      looksLikeScoredResults([
        ['a@x.com', '2026-05-01', 'Back Squat', '100', '5', 'kg'],
        ['b@x.com', '2026-05-02', 'Deadlift', '180', '3', 'kg'],
      ]),
    ).toBe(false);
  });

  it('is false on empty input', () => {
    expect(looksLikeScoredResults([])).toBe(false);
  });
});

describe('matchMovement', () => {
  it('matches by canonical name (case-insensitive)', () => {
    expect(matchMovement('Back Squat')).toBe('back_squat');
    expect(matchMovement('back squat')).toBe('back_squat');
  });

  it('matches by alias', () => {
    expect(matchMovement('OHS')).toBe('overhead_squat');
  });

  it('returns null for unknown movement', () => {
    expect(matchMovement('Zercher walk-out')).toBeNull();
  });
});

describe('buildWorkoutRows', () => {
  const headers = ['email', 'date', 'movement', 'weight', 'reps', 'unit'];
  const mapping = ['email', 'date', 'movement', 'weight', 'reps', 'unit'] as const;

  it('coerces a clean row', () => {
    const { ready, misses } = buildWorkoutRows(
      headers,
      mapping as never,
      [['izzy@example.com', '2026-05-01', 'Back Squat', '100', '5', 'kg']],
    );
    expect(ready).toEqual([
      {
        email: 'izzy@example.com',
        date: '2026-05-01',
        movement_key: 'back_squat',
        reps: 5,
        weight: 100,
        unit: 'kg',
        notes: null,
      },
    ]);
    expect(misses).toEqual([]);
  });

  it('flags rows whose movement does not resolve', () => {
    const { ready, misses } = buildWorkoutRows(
      headers,
      mapping as never,
      [['j@example.com', '2026-05-01', 'mysterious lift', '100', '5', 'kg']],
    );
    expect(ready).toEqual([]);
    expect(misses).toEqual([{ value: 'mysterious lift', rowIndex: 0 }]);
  });

  it('skips rows missing email or date', () => {
    const { ready, skippedNoEmail, skippedNoDate } = buildWorkoutRows(
      headers,
      mapping as never,
      [
        ['', '2026-05-01', 'back squat', '100', '5', 'kg'],
        ['j@example.com', '', 'back squat', '100', '5', 'kg'],
      ],
    );
    expect(ready).toEqual([]);
    expect(skippedNoEmail).toBe(1);
    expect(skippedNoDate).toBe(1);
  });

  it('defaults reps to 1 when missing', () => {
    const { ready } = buildWorkoutRows(
      headers,
      mapping as never,
      [['j@example.com', '2026-05-01', 'deadlift', '180', '', 'kg']],
    );
    expect(ready[0]?.reps).toBe(1);
  });
});

describe('parseTimeToSeconds', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(parseTimeToSeconds('3:12')).toBe(192);
    expect(parseTimeToSeconds('0:45')).toBe(45);
    expect(parseTimeToSeconds('1:05:10')).toBe(3910);
  });
  it('rejects out-of-range and non-clock values', () => {
    expect(parseTimeToSeconds('3:99')).toBeNull();
    expect(parseTimeToSeconds('140')).toBeNull();
    expect(parseTimeToSeconds('')).toBeNull();
  });
});

describe('parseRoundsReps', () => {
  it('parses R+r and a bare round count', () => {
    expect(parseRoundsReps('19+7')).toEqual({ rounds: 19, extraReps: 7 });
    expect(parseRoundsReps('20 + 14')).toEqual({ rounds: 20, extraReps: 14 });
    expect(parseRoundsReps('19')).toEqual({ rounds: 19, extraReps: 0 });
  });
  it('returns null for junk', () => {
    expect(parseRoundsReps('3:12')).toBeNull();
    expect(parseRoundsReps('')).toBeNull();
  });
});

describe('classifyScoreType', () => {
  it('routes score types to buckets', () => {
    expect(classifyScoreType('FOR_TIME')).toBe('for_time');
    expect(classifyScoreType('FOR_ROUNDS_REPS')).toBe('amrap');
    expect(classifyScoreType('AMRAP')).toBe('amrap');
    expect(classifyScoreType('FOR_WEIGHT')).toBe('weighted');
    expect(classifyScoreType('TIME')).toBe('deferred');
    expect(classifyScoreType('')).toBeNull();
    expect(classifyScoreType('mystery')).toBeNull();
  });
});

describe('buildResults', () => {
  const headers = ['Email', 'Name', 'Date', 'Score Type', 'Score Value', 'Unit'];
  const mapping = [
    'email',
    'movement',
    'date',
    'score_type',
    'score_value',
    null,
  ] as const;

  it('splits a mixed export into sections, weighted, deferred', () => {
    const r = buildResults(headers, mapping as never, [
      ['izzy@x.com', 'Fran', '2026-07-01', 'FOR_TIME', '3:12', 'mm:ss'],
      ['izzy@x.com', 'Cindy', '2026-07-05', 'FOR_ROUNDS_REPS', '19+7', 'rounds+reps'],
      ['izzy@x.com', 'Back Squat 1RM', '2026-07-14', 'FOR_WEIGHT', '140', 'kg'],
      ['izzy@x.com', 'Hyrox London', '2026-07-12', 'TIME', '3:58', 'mm:ss'],
    ]);
    expect(r.sections).toHaveLength(2);
    expect(r.deferred).toBe(1);
    // Back Squat 1RM doesn't resolve to a vocab movement → an unknown miss.
    expect(r.weighted).toHaveLength(0);
    expect(r.misses).toHaveLength(1);

    const fran = r.sections.find((s) => s.title === 'Fran');
    expect(fran).toMatchObject({
      section_category: 'wod',
      section_format: 'for_time',
      total_time_seconds: 192,
      date: '2026-07-01',
    });
    const cindy = r.sections.find((s) => s.title === 'Cindy');
    expect(cindy).toMatchObject({
      section_format: 'amrap',
      total_rounds: 19,
      total_extra_reps: 7,
    });
  });

  it('sends every row to the weighted path when no score type is mapped', () => {
    const r = buildResults(
      ['Email', 'Date', 'Movement', 'Weight', 'Reps'],
      ['email', 'date', 'movement', 'weight', 'reps'] as never,
      [['izzy@x.com', '2026-05-01', 'Back Squat', '100', '5']],
    );
    expect(r.sections).toHaveLength(0);
    expect(r.weighted).toHaveLength(1);
    expect(r.weighted[0]?.movement_key).toBe('back_squat');
  });
});
