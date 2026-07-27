import { describe, expect, it } from 'vitest';

import { findPrescriptions } from './percent-prescription';

describe('findPrescriptions', () => {
  it('finds nothing in a body with no percentage', () => {
    expect(
      findPrescriptions({ title: 'Back Squat', body: '5x5 building heavy.' }),
    ).toEqual([]);
  });

  it('resolves a movement named in the same clause', () => {
    expect(
      findPrescriptions({
        title: 'Strength',
        body: '6 rounds: 50m farmers carry, heavy, plus 3x8 deadlift @ 75%.',
      }),
    ).toEqual([
      { pct: 75, movementKey: 'deadlift', ambiguousTerm: null, skipped: null },
    ]);
  });

  it('falls back to the section title when the body names no movement', () => {
    const found = findPrescriptions({
      title: 'Back Squat',
      body: '5x3 @ 70%, then EMOM 10 touch-and-go doubles @ 60%.',
    });
    expect(found).toEqual([
      { pct: 70, movementKey: 'back_squat', ambiguousTerm: null, skipped: null },
      { pct: 60, movementKey: 'back_squat', ambiguousTerm: null, skipped: null },
    ]);
  });

  it('skips a percentage of a session max rather than guessing', () => {
    expect(
      findPrescriptions({
        title: 'Back Squat',
        body: "5-3-1 across, then max reps at 70% of today's 1.",
      }),
    ).toEqual([
      { pct: 70, movementKey: null, ambiguousTerm: null, skipped: 'session_relative' },
    ]);
  });

  it("skips 'of today's top' too", () => {
    const found = findPrescriptions({
      title: 'Snatch',
      body: "Build to a heavy single, then 3x2 @ 80% of today's top.",
    });
    expect(found).toHaveLength(1);
    expect(found[0].skipped).toBe('session_relative');
  });

  it('honours an explicit "of <movement>" after the percentage', () => {
    // The work is a clean pull but the reference is the clean, and
    // bare "clean" is ambiguous — so both percentages ask the same
    // question, which one answer resolves.
    const found = findPrescriptions({
      title: 'Cleans',
      body: '4x3 clean pull @ 90% of clean, then 5x1 clean @ 80%.',
    });
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ pct: 90, movementKey: null, ambiguousTerm: 'clean' });
    expect(found[1]).toMatchObject({ pct: 80, movementKey: null, ambiguousTerm: 'clean' });
  });

  it('expands a range into two percentages', () => {
    const found = findPrescriptions({
      title: 'Front Squat',
      body: '4x2 front squat @ 70-80%',
    });
    expect(found.map((p) => p.pct)).toEqual([70, 80]);
    expect(found.every((p) => p.movementKey === 'front_squat')).toBe(true);
  });

  it('reads the "at 75%" and "@75 %" spellings', () => {
    expect(
      findPrescriptions({ title: 'x', body: 'bench press at 75%' })[0],
    ).toMatchObject({ pct: 75, movementKey: 'bench_press' });
    expect(
      findPrescriptions({ title: 'x', body: 'bench press @75 %' })[0],
    ).toMatchObject({ pct: 75, movementKey: 'bench_press' });
  });

  it('keeps two movements in one clause ambiguous', () => {
    const found = findPrescriptions({
      title: 'Complex',
      body: 'front squat into push press @ 70%',
    });
    expect(found[0].movementKey).toBeNull();
  });

  it('reports nothing to ask when there is no movement text at all', () => {
    const found = findPrescriptions({ title: 'Conditioning', body: 'Row @ 70%' });
    expect(found[0]).toMatchObject({ movementKey: null, ambiguousTerm: null });
  });

  it('skips percentages of things that are not a load', () => {
    // These would otherwise fall through to the section title and put
    // a weight on the bar nobody prescribed.
    for (const body of [
      '5x5 @ 90% effort',
      'row at 70% max HR',
      '3 rounds at 80% of bodyweight',
      'hold at 60% bodyweight',
      'intervals @ 85% pace',
    ]) {
      const found = findPrescriptions({ title: 'Back Squat', body });
      expect(found.every((p) => p.skipped === 'non_load')).toBe(true);
    }
  });

  it('does not read a rep scheme as a percentage range', () => {
    // "21-15-9", "5-3-1" and "50-40-30-20-10" are rep schemes; only a
    // number pair immediately before the % sign is a range.
    expect(
      findPrescriptions({ title: 'Deadlift', body: '5-3-1 across, then 3x3 deadlift @ 70%' }),
    ).toEqual([
      { pct: 70, movementKey: 'deadlift', ambiguousTerm: null, skipped: null },
    ]);
    expect(
      findPrescriptions({ title: 'Thruster', body: '21-15-9 thruster @ 60%' }).map((p) => p.pct),
    ).toEqual([60]);
  });

  it('resolves each clause independently', () => {
    const found = findPrescriptions({
      title: 'Strength',
      body: '5x3 back squat @ 75%\n3x5 bench press @ 70%',
    });
    expect(found).toEqual([
      { pct: 75, movementKey: 'back_squat', ambiguousTerm: null, skipped: null },
      { pct: 70, movementKey: 'bench_press', ambiguousTerm: null, skipped: null },
    ]);
  });
});
