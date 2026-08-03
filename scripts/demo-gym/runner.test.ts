import { describe, expect, it } from 'vitest';

import { rng } from './simulate';
import {
  buildCast,
  buildWritePlan,
  daysBetween,
  predictClassReturn,
  runSimulation,
  sessionKey,
  simWindow,
  toSimSessions,
  type RosterMember,
  type SlotDef,
  type WriteContext,
} from './runner';

function roster(n: number, over: Partial<RosterMember> = {}): RosterMember[] {
  return Array.from({ length: n }, (_, i) => ({
    profileId: `p${String(i).padStart(2, '0')}`,
    name: `Member ${i}`,
    joinedAtISO: '2026-01-15T09:00:00Z',
    importLinked: false,
    hasAttendedEver: true,
    ...over,
  }));
}

const SLOT: SlotDef = {
  recurrenceId: 'rec-1',
  classTypeId: 'ct-1',
  className: 'CrossFit',
  dow: 2,
  time: '06:00',
  capacity: 20,
  durationMinutes: 60,
};

function ctx(over: Partial<WriteContext> = {}): WriteContext {
  let n = 0;
  return {
    gymId: 'gym-1',
    tz: 'Europe/London',
    ownerId: 'owner-1',
    coachIds: ['coach-1', 'coach-2'],
    todayISO: '2026-08-03',
    windowStartISO: '2026-06-07',
    existingSessions: new Map(),
    existingBookings: new Set(),
    subscriptionByProfile: new Map(),
    uuid: () => `uuid-${n++}`,
    rng: rng(7),
    ...over,
  };
}

describe('simWindow', () => {
  // Sunday-snapping is what lets the sim's dayIndex%7 dow convention be
  // used unchanged: day 0 falls on a real Sunday.
  it('starts on a Sunday at least the asked days back, ending yesterday', () => {
    const { startISO, totalDays } = simWindow('2026-08-03', 56); // a Monday
    expect(new Date(`${startISO}T12:00:00Z`).getUTCDay()).toBe(0);
    expect(totalDays).toBeGreaterThanOrEqual(56);
    expect(daysBetween(startISO, '2026-08-03')).toBe(totalDays);
  });

  it('is exact when the maths already lands on a Sunday', () => {
    // 2026-08-02 is a Sunday; 56 days before is also a Sunday.
    const { startISO, totalDays } = simWindow('2026-08-02', 56);
    expect(startISO).toBe('2026-06-07');
    expect(totalDays).toBe(56);
  });
});

describe('buildCast', () => {
  it('is deterministic for a given seed', () => {
    const a = buildCast(roster(30), '2026-08-03', '2026-06-07', rng(5));
    const b = buildCast(roster(30), '2026-08-03', '2026-06-07', rng(5));
    expect(a).toEqual(b);
  });

  it('gives a thirty-person gym drifters as well as regulars', () => {
    const { cast } = buildCast(roster(30), '2026-08-03', '2026-06-07', rng(5));
    const kinds = new Set(cast.map((m) => m.personality));
    expect(kinds.has('regular')).toBe(true);
    expect(kinds.has('drifting')).toBe(true);
  });

  // The seeder backdates every join 60-300 days, which the first-week
  // tick can never see. The cast plan moves at most three joins into the
  // 7-30 day window — three because the job proposes at most three a day.
  it('re-dates at most three never-started members into the first-week window', () => {
    const { cast, redates, clearBookingsFor } = buildCast(
      roster(60),
      '2026-08-03',
      '2026-06-07',
      rng(5),
    );
    expect(redates.length).toBeGreaterThan(0);
    expect(redates.length).toBeLessThanOrEqual(3);
    for (const r of redates) {
      const daysAgo = daysBetween(r.newJoinISO, '2026-08-03');
      expect(daysAgo).toBeGreaterThanOrEqual(7);
      expect(daysAgo).toBeLessThanOrEqual(30);
      // "Joined recently and never came" needs the seeded history gone.
      expect(clearBookingsFor).toContain(r.profileId);
      // And the sim must not book them either — joinedDayIndex keeps
      // them out of every earlier day.
      const m = cast.find((c) => c.id === r.profileId)!;
      expect(m.personality).toBe('never_started');
      expect(m.joinedDayIndex).toBe(daysBetween('2026-06-07', r.newJoinISO));
    }
  });

  // The rule the first-week job lives or dies by, kept at the cast level
  // too: an imported member's join date is not ours to move.
  it('never re-dates an import-linked member', () => {
    const members = roster(60, { importLinked: true });
    const { redates, cast } = buildCast(members, '2026-08-03', '2026-06-07', rng(5));
    expect(redates).toEqual([]);
    expect(cast.some((m) => m.personality === 'never_started')).toBe(false);
  });
});

describe('buildWritePlan', () => {
  function simDays(members = 24, seed = 11) {
    const { cast } = buildCast(roster(members), '2026-08-03', '2026-06-07', rng(seed));
    return runSimulation(cast, toSimSessions([SLOT]), 56, rng(seed + 1));
  }

  it('creates one session per occupied slot-day and books into it', () => {
    const days = simDays();
    const plan = buildWritePlan(days, [SLOT], ctx());
    const perStart = new Map<string, number>();
    for (const s of plan.sessions) {
      perStart.set(s.starts_at, (perStart.get(s.starts_at) ?? 0) + 1);
    }
    for (const n of perStart.values()) expect(n).toBe(1);
    const ids = new Set(plan.sessions.map((s) => s.id));
    for (const b of plan.bookings) expect(ids.has(b.class_session_id)).toBe(true);
    expect(plan.bookings.length).toBeGreaterThan(50);
  });

  it('reuses a session the seeder already wrote instead of duplicating it', () => {
    const days = simDays();
    const first = buildWritePlan(days, [SLOT], ctx());
    const seeded = new Map([[sessionKey(first.sessions[0].starts_at, 'ct-1'), 'seeded-id']]);
    const plan = buildWritePlan(days, [SLOT], ctx({ existingSessions: seeded }));
    expect(plan.sessions.length).toBe(first.sessions.length - 1);
    expect(plan.bookings.some((b) => b.class_session_id === 'seeded-id')).toBe(true);
  });

  it('skips a booking pair the seeder already made', () => {
    const days = simDays();
    const first = buildWritePlan(days, [SLOT], ctx());
    const seededSession = sessionKey(first.sessions[0].starts_at, 'ct-1');
    const seededMember = first.bookings.find(
      (b) => b.class_session_id === first.sessions[0].id,
    )!.profile_id;
    const plan = buildWritePlan(
      days,
      [SLOT],
      ctx({
        existingSessions: new Map([[seededSession, 'seeded-id']]),
        existingBookings: new Set([`seeded-id@${seededMember}`]),
      }),
    );
    expect(plan.skippedExistingBookings).toBeGreaterThan(0);
    expect(plan.bookings.filter(
      (b) => b.class_session_id === 'seeded-id' && b.profile_id === seededMember,
    )).toEqual([]);
  });

  it('mirrors attendance into the columns the ticks read', () => {
    const plan = buildWritePlan(simDays(), [SLOT], ctx());
    const attended = plan.bookings.filter((b) => b.attended_at !== null);
    const missed = plan.bookings.filter((b) => b.attended_at === null);
    expect(attended.length).toBeGreaterThan(0);
    expect(missed.length).toBeGreaterThan(0);
    for (const b of missed) {
      expect(b.no_show).toBe(true);
      expect(b.no_show_marked_at).not.toBeNull();
    }
    for (const b of attended) expect(b.no_show).toBe(false);
  });

  it('collapses repeat card failures into one dunning row that Stripe is still retrying', () => {
    const subs = new Map(roster(24).map((m) => [m.profileId, `sub-${m.profileId}`]));
    const plan = buildWritePlan(simDays(), [SLOT], ctx({ subscriptionByProfile: subs }));
    expect(plan.dunning.length).toBeGreaterThan(0);
    const bySub = new Set(plan.dunning.map((d) => d.plan_subscription_id));
    expect(bySub.size).toBe(plan.dunning.length);
    for (const d of plan.dunning) {
      // Never null: null means Stripe gave up, which the sim has no
      // basis to claim, and it flips the revenue job to its last-resort
      // offer.
      expect(d.next_payment_attempt).not.toBeNull();
      expect(d.payment_failure_count).toBeGreaterThanOrEqual(1);
    }
  });

  it('drops a failure for somebody without an active subscription rather than inventing one', () => {
    const plan = buildWritePlan(simDays(), [SLOT], ctx());
    expect(plan.dunning).toEqual([]);
    expect(plan.failuresWithoutSubscription).toBeGreaterThan(0);
  });
});

describe('predictClassReturn', () => {
  it('labels the slot in owner words and splits at 28 days', () => {
    const days = runSimulation(
      buildCast(roster(24), '2026-08-03', '2026-06-07', rng(3)).cast,
      toSimSessions([SLOT]),
      56,
      rng(4),
    );
    const [p] = predictClassReturn(days, [SLOT], '2026-08-03', '2026-06-07');
    expect(p.label).toBe('CrossFit Tuesday 06:00');
    expect(p.earlier).not.toBeNull();
    expect(p.recent).not.toBeNull();
    // 56 days ending 2026-08-02 split at 2026-07-06: four Tuesdays each
    // side.
    expect(p.earlier!.sessions).toBe(4);
    expect(p.recent!.sessions).toBe(4);
  });
});
