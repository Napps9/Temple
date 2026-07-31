import { describe, expect, it } from 'vitest';

import {
  exportFilename,
  waitingLine,
  type TrainingSummary,
} from './training-export';

function summary(over: Partial<TrainingSummary> = {}): TrainingSummary {
  return {
    workouts: 0,
    results: 0,
    races: 0,
    gyms: 0,
    first_at: null,
    last_at: null,
    ...over,
  };
}

describe('what is waiting behind the tier', () => {
  // This line is the whole pitch on the one screen whose job is to be
  // worth paying for. "1 sessions" undoes it.
  it('counts one session as one', () => {
    expect(
      waitingLine(summary({ workouts: 1, gyms: 1, first_at: '2024-03-04' })),
    ).toBe('1 session since March 2024, at one gym.');
  });

  it('says how far back it goes and how wide it spans', () => {
    expect(
      waitingLine(summary({ workouts: 142, gyms: 2, first_at: '2022-09-15' })),
    ).toBe('142 sessions since September 2022, across 2 gyms.');
  });

  // Somebody with nothing logged is a different screen from somebody whose
  // record is locked, and must not be sold their own emptiness back.
  it('does not dress up an empty record', () => {
    expect(waitingLine(summary())).toBe('Nothing logged yet.');
  });

  // A solo-only athlete has workouts and no gym at all; the clause has to
  // drop rather than read "across 0 gyms".
  it('leaves the gyms out when there are none', () => {
    expect(waitingLine(summary({ workouts: 9, gyms: 0, first_at: '2025-01-02' }))).toBe(
      '9 sessions since January 2025.',
    );
  });

  it('survives a record with no dates on it', () => {
    expect(waitingLine(summary({ workouts: 3, gyms: 1 }))).toBe(
      '3 sessions, at one gym.',
    );
  });
});

describe('the file somebody keeps', () => {
  it('is dated, so two exports do not overwrite each other', () => {
    expect(exportFilename(new Date('2026-07-31T14:00:00Z'))).toBe(
      'temple-training-history-2026-07-31.json',
    );
  });
});
