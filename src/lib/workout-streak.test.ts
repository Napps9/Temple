import { describe, expect, it } from 'vitest';

import { localDayKey, workoutStreak } from './workout-streak';

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
