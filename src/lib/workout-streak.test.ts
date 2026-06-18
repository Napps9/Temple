import { describe, expect, it } from 'vitest';

import {
  localDayKey,
  sessionsThisMonth,
  weekStreak,
  workoutStreak,
} from './workout-streak';

const TODAY = new Date('2026-06-13T18:00:00');

function setOf(...isoDates: string[]): Set<string> {
  return new Set(isoDates.map((d) => localDayKey(new Date(`${d}T12:00:00`))));
}

describe('workoutStreak', () => {
  it('counts consecutive days ending today', () => {
    const logged = setOf('2026-06-11', '2026-06-12', '2026-06-13');
    expect(workoutStreak(logged, TODAY)).toBe(3);
  });

  it('does not break the streak when today has no log yet', () => {
    const logged = setOf('2026-06-10', '2026-06-11', '2026-06-12');
    expect(workoutStreak(logged, TODAY)).toBe(3);
  });

  it('breaks the streak when yesterday is missing', () => {
    const logged = setOf('2026-06-10', '2026-06-11', '2026-06-13');
    // The check walks back from today (logged → keeps going), then to
    // yesterday (not logged), so the streak is just today's 1.
    expect(workoutStreak(logged, TODAY)).toBe(1);
  });

  it('returns 0 when neither today nor yesterday is logged', () => {
    const logged = setOf('2026-06-09', '2026-06-10');
    expect(workoutStreak(logged, TODAY)).toBe(0);
  });

  it('handles an empty log set', () => {
    expect(workoutStreak(new Set(), TODAY)).toBe(0);
  });
});

// TODAY (Sat 2026-06-13) sits in the Mon-start week beginning Mon 8th;
// the prior weeks begin Jun 1 and May 25.
describe('weekStreak (week starts Monday)', () => {
  it('counts consecutive weeks with a logged day', () => {
    const logged = setOf('2026-06-13', '2026-06-03', '2026-05-27');
    expect(weekStreak(logged, TODAY, 'mon')).toBe(3);
  });

  it('does not break when this week has no log yet', () => {
    const logged = setOf('2026-06-03', '2026-05-27');
    expect(weekStreak(logged, TODAY, 'mon')).toBe(2);
  });

  it('breaks when a week in the middle is missing', () => {
    const logged = setOf('2026-06-13', '2026-05-27');
    expect(weekStreak(logged, TODAY, 'mon')).toBe(1);
  });

  it('handles an empty log set', () => {
    expect(weekStreak(new Set(), TODAY, 'mon')).toBe(0);
  });

  it('respects a Sunday week start', () => {
    // Sun 2026-06-07 opens TODAY's week when weeks start on Sunday.
    expect(weekStreak(setOf('2026-06-07'), TODAY, 'sun')).toBe(1);
  });
});

describe('sessionsThisMonth', () => {
  it('counts only days in the current calendar month', () => {
    const logged = setOf('2026-06-13', '2026-06-03', '2026-05-27');
    expect(sessionsThisMonth(logged, TODAY)).toBe(2);
  });

  it('excludes days in other months', () => {
    expect(sessionsThisMonth(setOf('2026-06-13', '2026-07-01'), TODAY)).toBe(1);
  });

  it('handles an empty log set', () => {
    expect(sessionsThisMonth(new Set(), TODAY)).toBe(0);
  });
});
