import { describe, expect, it } from 'vitest';

import {
  buildEditArgs,
  describeEditResult,
  fmtPattern,
  otherTimesNote,
  shiftTimes,
  type EditDraft,
} from './class-edit';

const BASE: EditDraft = {
  classTypeId: 'ct-1',
  coachId: 'coach-1',
  dateIso: '2026-09-09',
  time: '06:00',
  duration: '60',
  capacity: '14',
  location: 'Main floor',
  notes: '',
};

function args(
  draft: Partial<EditDraft>,
  over: { scope?: 'one' | 'from' | 'series'; patternTimes?: string[] } = {},
) {
  return buildEditArgs({
    sessionId: 's-1',
    scope: over.scope ?? 'one',
    tz: 'Europe/London',
    original: BASE,
    draft: { ...BASE, ...draft },
    patternTimes: over.patternTimes,
  });
}

describe('what a save actually sends', () => {
  // Every field the RPC leaves alone on null has to be null when it did not
  // change, or a single-field edit quietly rewrites the rest of the class
  // with the values that happened to be in the form.
  it('sends only the field that changed', () => {
    const out = args({ capacity: '20' });
    expect(out).toHaveProperty('args');
    if (!('args' in out)) return;
    expect(out.args.p_capacity).toBe(20);
    expect(out.args.p_duration).toBeNull();
    expect(out.args.p_starts_at).toBeNull();
    expect(out.args.p_class_type_id).toBeNull();
    expect(out.args.p_coach_id).toBeNull();
    expect(out.args.p_clear_coach).toBe(false);
    expect(out.args.p_location).toBeNull();
    expect(out.args.p_clear_location).toBe(false);
  });

  it('refuses a save with nothing in it', () => {
    expect(args({})).toEqual({ problem: 'Nothing has changed yet.' });
  });

  // Retyping the same value is not a change, and whitespace is not an edit.
  it('treats a retyped value and stray whitespace as no change', () => {
    expect(args({ capacity: '14', location: '  Main floor  ' })).toEqual({
      problem: 'Nothing has changed yet.',
    });
  });

  // Emptying a nullable field is a real instruction, and null cannot carry
  // it — the RPC would read it as "leave alone" and the room would stay.
  it('asks to clear a room, rather than sending null for it', () => {
    const out = args({ location: '' });
    if (!('args' in out)) throw new Error('expected args');
    expect(out.args.p_clear_location).toBe(true);
    expect(out.args.p_location).toBeNull();
  });

  it('asks to clear a coach the same way', () => {
    const out = args({ coachId: null });
    if (!('args' in out)) throw new Error('expected args');
    expect(out.args.p_clear_coach).toBe(true);
    expect(out.args.p_coach_id).toBeNull();
  });

  // The gym's timezone, not the browser's: a manager signed in from another
  // country would otherwise move the class by the offset between them.
  it('resolves the new start in the gym timezone', () => {
    const out = buildEditArgs({
      sessionId: 's-1',
      scope: 'one',
      tz: 'America/New_York',
      original: BASE,
      draft: { ...BASE, time: '09:00' },
    });
    if (!('args' in out)) throw new Error('expected args');
    // 09:00 in New York on 9 September is 13:00 UTC.
    expect(out.args.p_starts_at).toBe('2026-09-09T13:00:00.000Z');
  });

  it('holds the same bounds the RPC does', () => {
    expect(args({ duration: '3' })).toEqual({
      problem: 'A class runs between 5 minutes and 8 hours.',
    });
    expect(args({ duration: '600' })).toEqual({
      problem: 'A class runs between 5 minutes and 8 hours.',
    });
    expect(args({ capacity: '0' })).toEqual({ problem: 'Capacity is at least 1.' });
    expect(args({ time: '6am' })).toEqual({
      problem: 'Give the start time as HH:MM, like 06:30.',
    });
  });
});

describe('what a series will and will not do', () => {
  it('lets one class move to another day', () => {
    const out = args({ dateIso: '2026-09-10' }, { scope: 'one' });
    expect(out).toHaveProperty('args');
  });

  // days_of_week decides which days the pattern fires on, so moving a
  // series onto another day is not a move, it is a different schedule.
  it('will not move a series onto another day', () => {
    for (const scope of ['from', 'series'] as const) {
      expect(args({ dateIso: '2026-09-10' }, { scope })).toEqual({
        problem:
          'A series keeps its days. To move one class to another day, choose “Just this one”.',
      });
    }
  });

  it('will not shunt a sibling time past midnight', () => {
    expect(
      args({ time: '07:30' }, { scope: 'series', patternTimes: ['06:00', '23:00'] }),
    ).toEqual({
      problem:
        'That would push one of this schedule’s times past midnight, which would change the days it runs on.',
    });
  });

  it('allows the same move when no sibling time is near the end of the day', () => {
    expect(
      args({ time: '07:30' }, { scope: 'series', patternTimes: ['06:00', '17:30'] }),
    ).toHaveProperty('args');
  });
});

describe('mirroring the shift the database does', () => {
  it('shifts every time, and gives up at either end of the day', () => {
    expect(shiftTimes(['06:00', '17:30'], 30)).toEqual(['06:30', '18:00']);
    expect(shiftTimes(['06:00'], -30)).toEqual(['05:30']);
    expect(shiftTimes(['23:30'], 45)).toBeNull();
    expect(shiftTimes(['00:15'], -30)).toBeNull();
    expect(shiftTimes(['06:00'], 0)).toEqual(['06:00']);
  });

  // A schedule that runs twice a day moves both times, which is what the
  // pattern can express and what bulk_edit_sessions already does. Saying it
  // is the difference between a deliberate change and a surprise.
  it('names the other times a series move takes with it', () => {
    expect(otherTimesNote(['06:00', '17:30'], '06:00', 30)).toBe(
      'This schedule runs more than once a day, so it also moves 17:30 to 18:00.',
    );
    expect(otherTimesNote(['06:00', '12:00', '17:30'], '06:00', 30)).toBe(
      'This schedule runs more than once a day, so it also moves 12:00 to 12:30 and 17:30 to 18:00.',
    );
  });

  it('says nothing when there is nothing surprising', () => {
    expect(otherTimesNote(['06:00'], '06:00', 30)).toBeNull();
    expect(otherTimesNote(['06:00', '17:30'], '06:00', 0)).toBeNull();
  });
});

describe('saying what happened', () => {
  const base = {
    updated: 0,
    skipped_overbooked: 0,
    skipped_past: 0,
    skipped_conflict: 0,
    notified: 0,
    schedule: 'none' as const,
  };

  it('reads as one class when it was one class', () => {
    expect(describeEditResult({ ...base, updated: 1 })).toEqual([
      'That class is updated.',
    ]);
  });

  // The line that matters most and is easiest to leave out: a pattern left
  // alone will put these classes back the next time anybody edits the
  // schedule, and nothing else on screen would ever say so.
  it('warns that a schedule left alone will undo the change', () => {
    const lines = describeEditResult({
      ...base,
      updated: 30,
      skipped_overbooked: 1,
      schedule: 'unchanged',
    });
    expect(lines[0]).toBe('30 classes are updated.');
    expect(lines[1]).toContain('more members are booked into it');
    expect(lines[2]).toContain('will put these back');
  });

  it('says when the schedule carries the change from a day onward', () => {
    expect(
      describeEditResult({ ...base, updated: 12, notified: 3, schedule: 'split' }),
    ).toEqual([
      '12 classes are updated.',
      '3 members were told.',
      'The repeating schedule now carries this from that day onward.',
    ]);
  });
});

describe('describing a pattern the same way in both dialogs', () => {
  it('folds the common shapes', () => {
    expect(fmtPattern([1, 2, 3, 4, 5], ['06:00', '17:30'])).toBe(
      'Weekdays at 06:00 and 17:30',
    );
    expect(fmtPattern([0, 6], ['09:00'])).toBe('Weekends at 09:00');
    expect(fmtPattern([3], ['12:00'])).toBe('Wednesdays at 12:00');
    expect(fmtPattern([0, 1, 2, 3, 4, 5, 6], ['10:00'])).toBe('Every day at 10:00');
  });
});
