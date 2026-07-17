import { describe, expect, it } from 'vitest';

import {
  autoDetect,
  buildWorkoutRows,
  looksLikeScoredResults,
  matchMovement,
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
    // so it must not be auto-mapped to Weight unit.
    expect(
      autoDetect(
        ['Member Email', 'Date', 'Event/Workout Name', 'Score Value', 'Unit'],
        [
          ['a@x.com', '01/07/2026', 'Fran', '3:12', 'mm:ss'],
          ['b@x.com', '05/07/2026', 'Cindy', '19+7', 'rounds+reps'],
        ],
      ),
    ).toEqual(['email', 'date', 'movement', null, null]);
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
