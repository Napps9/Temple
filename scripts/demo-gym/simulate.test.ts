import { describe, expect, it } from 'vitest';

import {
  likelihood,
  rng,
  simulateDay,
  summariseSlots,
  wouldFireClassReturn,
  type SimMember,
  type SimSession,
} from './simulate';

function member(over: Partial<SimMember> = {}): SimMember {
  return {
    id: 'm1',
    name: 'Sam',
    personality: 'regular',
    enthusiasm: 1,
    joinedDayIndex: 0,
    ...over,
  };
}

const TUE_6AM: SimSession = { id: 's-tue-6', dow: 2, at: '06:00', capacity: 20 };
const SAT_9AM: SimSession = { id: 's-sat-9', dow: 6, at: '09:00', capacity: 20 };

describe('rng', () => {
  // A simulation you cannot replay is an anecdote. The whole value of a
  // bad month is being able to look at it twice.
  it('is fully determined by its seed', () => {
    const a = rng(42);
    const b = rng(42);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    const c = rng(43);
    expect(c()).not.toEqual(first[0]);
  });

  it('stays inside 0..1', () => {
    const next = rng(7);
    for (let i = 0; i < 500; i += 1) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('likelihood', () => {
  it('puts the weekender at the weekend and almost nowhere else', () => {
    const m = member({ personality: 'weekender' });
    expect(likelihood(m, SAT_9AM, 0)).toBeGreaterThan(0.5);
    expect(likelihood(m, TUE_6AM, 0)).toBeLessThan(0.1);
  });

  it('keeps the twice-weekly person to their two slots', () => {
    const m = member({ personality: 'twice_weekly' });
    expect(likelihood(m, TUE_6AM, 0)).toBeGreaterThan(0.7);
    expect(likelihood(m, SAT_9AM, 0)).toBeLessThan(0.1);
  });

  // The one the class-return job exists to notice. A drifter has to look
  // like a regular early and like a ghost later, or no slot ever thins
  // out and the job can never fire on anything.
  it('fades the drifter week by week rather than dropping them', () => {
    const m = member({ personality: 'drifting' });
    const w0 = likelihood(m, TUE_6AM, 0);
    const w3 = likelihood(m, TUE_6AM, 3);
    const w8 = likelihood(m, TUE_6AM, 8);
    expect(w0).toBeGreaterThan(0.5);
    expect(w3).toBeLessThan(w0 * 0.6);
    expect(w8).toBeLessThan(0.1);
    // Gradual, not a cliff — a cliff is a cancellation, which is a
    // different event the gym should read differently.
    expect(w3).toBeGreaterThan(0);
  });

  it('never brings in somebody who has not started', () => {
    const m = member({ personality: 'never_started' });
    expect(likelihood(m, TUE_6AM, 0)).toBe(0);
    expect(likelihood(m, SAT_9AM, 5)).toBe(0);
  });
});

describe('simulateDay', () => {
  it('only runs the sessions that fall on that weekday', () => {
    const next = rng(1);
    // dayIndex 2 is a Tuesday under the 0=Sun convention.
    const day = simulateDay(2, [member()], [TUE_6AM, SAT_9AM], next);
    for (const a of day.attendance) expect(a.sessionId).toBe('s-tue-6');
  });

  it('never books somebody before they joined', () => {
    const next = rng(2);
    const late = member({ id: 'later', joinedDayIndex: 40 });
    const day = simulateDay(2, [late], [TUE_6AM], next);
    expect(day.attendance).toEqual([]);
  });

  it('never books a session past its capacity', () => {
    const next = rng(3);
    const small: SimSession = { ...TUE_6AM, capacity: 3 };
    const crowd = Array.from({ length: 40 }, (_, i) => member({ id: `m${i}` }));
    const day = simulateDay(2, crowd, [small], next);
    expect(day.attendance.length).toBeLessThanOrEqual(3);
  });

  // Booked and attended are different facts. A class that is full of
  // people who did not turn up is not a healthy slot, and a simulation
  // that conflates them hides the whole no-show half of the product.
  it('produces bookings that were not honoured', () => {
    const next = rng(9);
    const crowd = Array.from({ length: 30 }, (_, i) => member({ id: `m${i}` }));
    let booked = 0;
    let noShows = 0;
    for (let d = 0; d < 140; d += 1) {
      const day = simulateDay(d, crowd, [TUE_6AM], next);
      booked += day.attendance.length;
      noShows += day.attendance.filter((a) => !a.attended).length;
    }
    expect(booked).toBeGreaterThan(100);
    expect(noShows).toBeGreaterThan(0);
    expect(noShows).toBeLessThan(booked * 0.25);
  });

  it('lets a card fail sometimes and not most days', () => {
    const next = rng(11);
    const crowd = Array.from({ length: 20 }, (_, i) => member({ id: `m${i}` }));
    let failures = 0;
    for (let d = 0; d < 200; d += 1) {
      failures += simulateDay(d, crowd, [TUE_6AM], next).paymentFailures.length;
    }
    expect(failures).toBeGreaterThan(0);
    expect(failures).toBeLessThan(60);
  });
});

describe('summariseSlots', () => {
  it('averages attendance per session, not per booking', () => {
    const days = [
      {
        dayIndex: 0,
        attendance: [
          { sessionId: 's', memberId: 'a', attended: true },
          { sessionId: 's', memberId: 'b', attended: false },
        ],
        paymentFailures: [],
        joined: [],
        left: [],
      },
      {
        dayIndex: 7,
        attendance: [{ sessionId: 's', memberId: 'a', attended: true }],
        paymentFailures: [],
        joined: [],
        left: [],
      },
    ];
    // Three bookings, two attended, across two sessions.
    expect(summariseSlots(days)).toEqual([
      { sessionId: 's', sessions: 2, attended: 2, average: 1 },
    ]);
  });
});

// The check that makes the simulation worth running. If a month of
// simulated drift never satisfies 0246's predicate, then either the
// simulation has no shape or the thresholds are unreachable — and both
// are worth knowing before anything is loaded into a database.
describe('wouldFireClassReturn', () => {
  it('fires on a real fall', () => {
    expect(
      wouldFireClassReturn(
        { sessionId: 's', sessions: 4, attended: 40, average: 10 },
        { sessionId: 's', sessions: 4, attended: 8, average: 2 },
      ),
    ).toBe(true);
  });

  it('stays quiet on a slot that was never busy', () => {
    expect(
      wouldFireClassReturn(
        { sessionId: 's', sessions: 4, attended: 12, average: 3 },
        { sessionId: 's', sessions: 4, attended: 0, average: 0 },
      ),
    ).toBe(false);
  });

  it('stays quiet on a small percentage fall from a big number', () => {
    expect(
      wouldFireClassReturn(
        { sessionId: 's', sessions: 4, attended: 80, average: 20 },
        { sessionId: 's', sessions: 4, attended: 68, average: 17 },
      ),
    ).toBe(false);
  });

  it('stays quiet on a big percentage fall of two people', () => {
    // 5 → 2.5 is 50%, but it is two and a half people. Both floors have
    // to be cleared, which is the rule that keeps a small class quiet.
    expect(
      wouldFireClassReturn(
        { sessionId: 's', sessions: 4, attended: 20, average: 5 },
        { sessionId: 's', sessions: 4, attended: 14, average: 3.5 },
      ),
    ).toBe(false);
  });

  it('needs three sessions each side before it will look', () => {
    expect(
      wouldFireClassReturn(
        { sessionId: 's', sessions: 2, attended: 20, average: 10 },
        { sessionId: 's', sessions: 4, attended: 4, average: 1 },
      ),
    ).toBe(false);
  });

  // The end-to-end question, and the reason to simulate at all: does a
  // gym full of drifters ever actually produce a slot the job would
  // speak up about?
  function run(drifters: number, regulars: number, seed: number) {
    const next = rng(seed);
    const crowd = [
      ...Array.from({ length: drifters }, (_, i) =>
        member({ id: `d${i}`, personality: 'drifting' }),
      ),
      ...Array.from({ length: regulars }, (_, i) =>
        member({ id: `r${i}`, personality: 'regular' }),
      ),
    ];
    const earlierDays = [];
    const recentDays = [];
    for (let d = 0; d < 56; d += 1) {
      const day = simulateDay(d, crowd, [{ ...TUE_6AM, capacity: 30 }], next);
      if (d < 28) earlierDays.push(day);
      else recentDays.push(day);
    }
    return {
      earlier: summariseSlots(earlierDays)[0],
      recent: summariseSlots(recentDays)[0],
    };
  }

  it('a busy slot that empties is one the job would notice', () => {
    // 20 drifting, 4 regular: 9.3 a session falling to 4.8.
    const { earlier, recent } = run(20, 4, 2026);
    expect(earlier.average).toBeGreaterThanOrEqual(4);
    expect(wouldFireClassReturn(earlier, recent)).toBe(true);
  });

  // THE SECOND FINDING, and the more interesting one. Same slot, same
  // decay, but six loyal regulars instead of four: 9.3 falls to 7.3, a
  // drop of 2.0 against a 3.7 bar, and the job says nothing — even though
  // the same sixteen people drifted away.
  //
  // A loyal core holds the average up and suppresses the signal. Whether
  // that is right is a real product question and not a bug: the class is
  // arguably still healthy, or you arguably just lost sixteen people in
  // silence. Pinned here so that changing the 40% rule is a decision
  // somebody makes on purpose rather than a number somebody nudges.
  it('but a loyal core hides the same loss', () => {
    const { earlier, recent } = run(16, 6, 2026);
    expect(earlier.average).toBeGreaterThanOrEqual(4);
    expect(recent.average).toBeLessThan(earlier.average);
    expect(wouldFireClassReturn(earlier, recent)).toBe(false);
  });

  // THE FINDING, and the whole argument for simulating before seeding.
  // Twelve people through one weekly slot averages under four a session,
  // which is below the job's floor — so on a gym that size the seventh
  // job can never fire, however badly the slot empties. That is the
  // threshold working as designed (four is where two holidays stop
  // looking like a trend), but it means a small demo gym would show the
  // job switched on and silent forever, and somebody would reasonably
  // conclude it was broken.
  it('and a twelve-person slot is below the floor however far it falls', () => {
    const { earlier, recent } = run(9, 3, 2026);
    expect(earlier.average).toBeLessThan(4);
    expect(recent.average).toBeLessThan(earlier.average);
    expect(wouldFireClassReturn(earlier, recent)).toBe(false);
  });
});
