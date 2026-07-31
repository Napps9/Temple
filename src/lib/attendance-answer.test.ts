import { describe, expect, it } from 'vitest';

import {
  attendanceAnswer,
  quietAnswer,
  shiftDays,
  weekdayIndex,
  weekdayName,
  weekdayOfDay,
  type AttendanceInput,
} from './attendance-answer';

function ask(partial: Partial<AttendanceInput>): AttendanceInput {
  return {
    label: 'the last 7 days',
    now: { attended: 0, noShow: 0, types: [], days: [] },
    before: { attended: 0, noShow: 0, types: [] },
    ...partial,
  };
}

describe('how busy have we been', () => {
  it('leads with the number and names the busiest day', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 84,
          noShow: 0,
          types: [],
          days: [
            { day: '2026-08-03', attended: 22 },
            { day: '2026-08-04', attended: 38 },
            { day: '2026-08-05', attended: 24 },
          ],
        },
      }),
    );
    expect(r.title).toBe('84 through the door over the last 7 days.');
    expect(r.lines[0]).toBe('Busiest was Tuesday 4 Aug with 38.');
  });

  // The line that turns a number into information, and the one most
  // easily made into a lie by a small denominator.
  it('compares periods only when the earlier one was big enough to mean something', () => {
    const real = attendanceAnswer(
      ask({
        now: { attended: 84, noShow: 0, types: [], days: [] },
        before: { attended: 70, noShow: 0, types: [] },
      }),
    );
    expect(real.lines).toContain('Up 20% on the period before, when it was 70.');

    const noisy = attendanceAnswer(
      ask({
        now: { attended: 12, noShow: 0, types: [], days: [] },
        before: { attended: 4, noShow: 0, types: [] },
      }),
    );
    expect(noisy.lines.join(' ')).not.toMatch(/%/);
    expect(noisy.lines).toContain(
      'The period before had 4, which is too few to read a trend from.',
    );
  });

  it('says level rather than up 0%', () => {
    const r = attendanceAnswer(
      ask({
        now: { attended: 40, noShow: 0, types: [], days: [] },
        before: { attended: 40, noShow: 0, types: [] },
      }),
    );
    expect(r.lines).toContain('Level with the period before.');
  });

  it('ranks the classes and stops at four', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 60,
          noShow: 0,
          days: [],
          types: [
            { name: 'Yoga', attended: 9 },
            { name: 'Barbell club', attended: 24 },
            { name: 'Open gym', attended: 14 },
            { name: 'Conditioning', attended: 8 },
            { name: 'Mobility', attended: 5 },
          ],
        },
      }),
    );
    // The split is drawn as a ranked list on the card (0243), not written
    // out here. Saying it in both places made the card read as though the
    // numbers disagreed until you checked that they did not.
    expect(r.lines.some((l) => l.includes('Barbell club 24'))).toBe(false);
  });
});

// "Which class is dying" is the question this exists to answer, and the
// one most worth getting wrong quietly: sending an owner to look at a
// class that had a quiet week costs them a decision they did not need to
// make.
describe('the class that is falling away', () => {
  it('names one when the fall is large and off a real base', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 40,
          noShow: 0,
          days: [],
          types: [
            { name: 'Barbell club', attended: 32 },
            { name: 'Yoga', attended: 8 },
          ],
        },
        before: {
          attended: 50,
          noShow: 0,
          types: [
            { name: 'Barbell club', attended: 29 },
            { name: 'Yoga', attended: 21 },
          ],
        },
      }),
    );
    expect(r.lines).toContain('Yoga is down from 21 to 8 — the biggest fall.');
  });

  it('says nothing about a class that was never big', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 30,
          noShow: 0,
          days: [],
          types: [{ name: 'Mobility', attended: 1 }],
        },
        before: {
          attended: 30,
          noShow: 0,
          types: [{ name: 'Mobility', attended: 4 }],
        },
      }),
    );
    expect(r.lines.join(' ')).not.toMatch(/Mobility is down/);
  });

  it('does not call a wobble a fall', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 30,
          noShow: 0,
          days: [],
          types: [{ name: 'Yoga', attended: 17 }],
        },
        before: { attended: 30, noShow: 0, types: [{ name: 'Yoga', attended: 20 }] },
      }),
    );
    expect(r.lines.join(' ')).not.toMatch(/biggest fall/);
  });

  // The steepest fall of all is invisible in the current period, because
  // a class nobody came to produces no rows at all.
  it('catches the class that emptied out completely', () => {
    const r = attendanceAnswer(
      ask({
        now: {
          attended: 30,
          noShow: 0,
          days: [],
          types: [{ name: 'Barbell club', attended: 30 }],
        },
        before: {
          attended: 44,
          noShow: 0,
          types: [
            { name: 'Barbell club', attended: 30 },
            { name: 'Yoga', attended: 14 },
          ],
        },
      }),
    );
    expect(r.lines).toContain('Yoga had 14 and now has nobody — worth a look.');
  });
});

describe('the two answers that are not numbers', () => {
  it('does not read an empty register as an empty gym', () => {
    const r = attendanceAnswer(ask({}));
    expect(r.title).toBe('Nobody was marked in over the last 7 days.');
    expect(r.lines[0]).toMatch(/registers were not taken/);
  });

  it('reports no-shows as a share of the seats taken', () => {
    const r = attendanceAnswer(
      ask({ now: { attended: 36, noShow: 4, types: [], days: [] } }),
    );
    expect(r.lines).toContain("4 booked in and didn't turn up — 10% of the seats taken.");
  });
});

describe('reading which day was asked about', () => {
  it('takes the shapes a model or an owner actually sends', () => {
    expect(weekdayIndex('Saturday')).toBe(6);
    expect(weekdayIndex('saturdays')).toBe(6);
    expect(weekdayIndex('sat')).toBe(6);
    expect(weekdayIndex(' TUESDAY ')).toBe(2);
  });

  it('refuses what it cannot resolve rather than guessing a day', () => {
    expect(weekdayIndex(null)).toBeNull();
    expect(weekdayIndex('')).toBeNull();
    expect(weekdayIndex('S')).toBeNull();
    expect(weekdayIndex('the weekend')).toBeNull();
    expect(weekdayName(null)).toBeNull();
    expect(weekdayName(7)).toBeNull();
  });

  it('names a day back the way it will be read', () => {
    expect(weekdayName(6)).toBe('Saturday');
    expect(weekdayName(0)).toBe('Sunday');
  });
});

describe('walking the calendar', () => {
  it('crosses months and years without drifting', () => {
    expect(shiftDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDays('2026-08-04', -6)).toBe('2026-07-29');
  });

  // The days come out of the gym's zone already, so the weekday must be
  // read off the calendar date and not off an instant — doing it twice
  // moves the boundary a second time.
  it('reads a weekday off the day key, not off a moment', () => {
    expect(weekdayOfDay('2026-08-01')).toBe(6);
    expect(weekdayOfDay('2026-08-03')).toBe(1);
  });
});

describe('who has gone quiet', () => {
  const larry = { name: 'Lapsed Larry', weeksAbsent: 10, paying: true };
  const nadia = { name: 'Never Nadia', weeksAbsent: null, paying: true };

  it('leads with the count and the window as it was asked', () => {
    const r = quietAnswer(4, [nadia, larry]);
    expect(r.title).toBe('2 members have not been in for a month.');
    expect(quietAnswer(1, [larry]).title).toBe('1 member has not been in for a week.');
    expect(quietAnswer(6, [larry]).title).toBe('1 member has not been in for 6 weeks.');
  });

  // The line that turns a list of names into a decision.
  it('puts the money first', () => {
    expect(quietAnswer(4, [nadia, larry]).lines[0]).toBe('All of them are still paying.');
    expect(
      quietAnswer(4, [larry, { ...nadia, paying: false }]).lines[0],
    ).toBe('1 of them is still paying.');
    expect(
      quietAnswer(4, [{ ...larry, paying: false }]).lines.join(' '),
    ).not.toMatch(/paying/);
  });

  // Stopped coming and never started are different conversations.
  it('keeps never-been apart from lapsed', () => {
    const r = quietAnswer(4, [nadia, larry]);
    expect(r.lines).toContain('1 has never been in at all.');
    expect(r.lines).toContain('Never Nadia — never been in; Lapsed Larry — 10 weeks.');
  });

  it('stops naming people after six', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `Member ${i + 1}`,
      weeksAbsent: 5,
      paying: false,
    }));
    const r = quietAnswer(4, many);
    expect(r.lines[r.lines.length - 1]).toBe('And 3 more.');
    expect(r.lines.join(' ')).not.toMatch(/Member 7/);
  });

  it('says so plainly when there is nobody', () => {
    expect(quietAnswer(4, [])).toEqual({
      title: 'Everybody has been in within a month.',
      lines: [],
    });
  });
});
