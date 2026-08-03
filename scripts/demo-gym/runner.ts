// Pure half of the simulation runner: everything that can be decided
// without a database. run-sim.ts queries the seeded gym, hands the rows
// here, and inserts what comes back — the same split the seeder uses
// (seed-demo-gym.ts ↔ plan.ts), and for the same reason: this half is
// testable and deterministic, the other half is I/O.

import { localToUtc, isoDateOffset } from './timetable';
import {
  simulateDay,
  summariseSlots,
  wouldFireClassReturn,
  type Personality,
  type SimDay,
  type SimMember,
  type SimSession,
  type SlotSummary,
} from './simulate';

export type Rng = () => number;

export type RosterMember = {
  profileId: string;
  name: string;
  joinedAtISO: string;
  // pending_members.linked_profile_id set — came across from another
  // platform. Never re-dated into the first-week window: the tick
  // excludes them and the whole point of that rule is people like this.
  importLinked: boolean;
  hasAttendedEver: boolean;
};

export type SlotDef = {
  recurrenceId: string;
  classTypeId: string;
  className: string;
  dow: number; // 0=Sun..6=Sat, matching class_recurrences
  time: string; // 'HH:MM' local
  capacity: number;
  durationMinutes: number;
};

// The sim's day-index convention is dow = dayIndex % 7 with 0=Sunday.
// Rather than translating every index, snap the window start back to a
// Sunday: day 0 falls on a real Sunday and the conventions line up for
// the whole run. `--days N` therefore means "at least N, extended to the
// previous Sunday", ending yesterday.
export function simWindow(
  todayISO: string,
  days: number,
): { startISO: string; totalDays: number } {
  const first = isoDateOffset(todayISO, -days);
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const startISO = isoDateOffset(first, -dow);
  return { startISO, totalDays: daysBetween(startISO, todayISO) };
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T12:00:00Z`) - Date.parse(`${fromISO}T12:00:00Z`)) /
      86_400_000,
  );
}

// Personalities in proportions that give a month some shape: a stable
// core, a visible drift, and a couple of people who never started. A
// uniform gym never thins out and every job stays silent (see
// simulate.ts).
const DISTRIBUTION: [Personality, number][] = [
  ['regular', 0.3],
  ['twice_weekly', 0.2],
  ['weekender', 0.1],
  ['drifting', 0.2],
  ['sporadic', 0.12],
  ['never_started', 0.08],
];

export type CastPlan = {
  cast: SimMember[];
  // Members the runner must UPDATE gym_memberships.created_at for, so
  // the first-week job has a candidate: the seeder backdates every join
  // 60-300 days, which is outside the tick's 7-30 day window forever.
  redates: { profileId: string; newJoinISO: string }[];
  // Re-dated members whose seeded history says they trained — "joined
  // recently, never been in" is only true once those bookings are gone.
  clearBookingsFor: string[];
};

export function buildCast(
  members: RosterMember[],
  todayISO: string,
  windowStartISO: string,
  rng: Rng,
): CastPlan {
  const shuffled = [...members].sort((a, b) =>
    a.profileId.localeCompare(b.profileId),
  );
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const personalities: Personality[] = shuffled.map((_, i) => {
    const frac = shuffled.length === 1 ? 0 : i / shuffled.length;
    let cum = 0;
    for (const [p, share] of DISTRIBUTION) {
      cum += share;
      if (frac < cum) return p;
    }
    return 'sporadic';
  });

  const redates: CastPlan['redates'] = [];
  const clearBookingsFor: string[] = [];
  const cast: SimMember[] = shuffled.map((m, i) => {
    let personality = personalities[i];
    let joinedISO = m.joinedAtISO.slice(0, 10);
    if (personality === 'never_started') {
      if (m.importLinked) {
        // An imported member must keep their real join date — they are
        // the rule's reason to exist — so they sit out the window as a
        // sporadic instead.
        personality = 'sporadic';
      } else if (redates.length < 3) {
        // 8, 12, 16 days ago: inside the tick's 7-30 day window with
        // room on both sides, and at most three because the job
        // proposes at most three a day.
        joinedISO = isoDateOffset(todayISO, -(8 + redates.length * 4));
        redates.push({ profileId: m.profileId, newJoinISO: joinedISO });
        if (m.hasAttendedEver) clearBookingsFor.push(m.profileId);
      }
    }
    return {
      id: m.profileId,
      name: m.name,
      personality,
      enthusiasm: 0.7 + rng() * 0.3,
      joinedDayIndex: Math.max(0, daysBetween(windowStartISO, joinedISO)),
    };
  });

  return { cast, redates, clearBookingsFor };
}

export function toSimSessions(slots: SlotDef[]): SimSession[] {
  return slots.map((s) => ({
    id: `${s.recurrenceId}@${s.dow}@${s.time}`,
    dow: s.dow,
    at: s.time,
    capacity: s.capacity,
  }));
}

export type SessionInsert = {
  id: string;
  gym_id: string;
  name: string;
  class_type_id: string;
  recurrence_id: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  coach_id: string;
  created_by: string;
};

export type BookingInsert = {
  id: string;
  gym_id: string;
  class_session_id: string;
  profile_id: string;
  created_at: string;
  attended_at: string | null;
  marked_by: string | null;
  no_show: boolean;
  no_show_marked_at: string | null;
};

export type DunningUpsert = {
  plan_subscription_id: string;
  profile_id: string;
  gym_id: string;
  past_due_since: string;
  payment_failure_count: number;
  last_payment_error: string;
  next_payment_attempt: string;
};

export type WriteContext = {
  gymId: string;
  tz: string;
  ownerId: string;
  coachIds: string[];
  todayISO: string;
  windowStartISO: string;
  // starts_at + '@' + class_type_id -> existing class_sessions.id, so a
  // seeded gym's own history is reused rather than duplicated.
  existingSessions: Map<string, string>;
  // class_session_id + '@' + profile_id for every existing booking in
  // the window — the seeder books people too, and (session, member) is
  // one fact.
  existingBookings: Set<string>;
  // profile_id -> active plan_subscriptions.id
  subscriptionByProfile: Map<string, string>;
  uuid: () => string;
  rng: Rng;
};

export type WritePlan = {
  sessions: SessionInsert[];
  bookings: BookingInsert[];
  dunning: DunningUpsert[];
  skippedExistingBookings: number;
  failuresWithoutSubscription: number;
};

export function sessionKey(startsAtUtc: string, classTypeId: string): string {
  return `${startsAtUtc}@${classTypeId}`;
}

export function buildWritePlan(
  days: SimDay[],
  slots: SlotDef[],
  ctx: WriteContext,
): WritePlan {
  const slotById = new Map(slots.map((s) => [`${s.recurrenceId}@${s.dow}@${s.time}`, s]));
  const sessions: SessionInsert[] = [];
  const bookings: BookingInsert[] = [];
  const sessionIdByKey = new Map(ctx.existingSessions);
  const bookedPairs = new Set(ctx.existingBookings);
  let skippedExistingBookings = 0;
  let coachCursor = 0;

  // First failure opens the case, later ones deepen it — collapse the
  // run's events per subscription so the upsert is one row.
  const failures = new Map<string, { first: string; last: string; count: number }>();

  for (const day of days) {
    const dateISO = isoDateOffset(ctx.windowStartISO, day.dayIndex);
    for (const a of day.attendance) {
      const slot = slotById.get(a.sessionId);
      if (!slot) continue;
      const startsAt = localToUtc(dateISO, slot.time, ctx.tz);
      const key = sessionKey(startsAt, slot.classTypeId);
      let sessionId = sessionIdByKey.get(key);
      if (!sessionId) {
        sessionId = ctx.uuid();
        sessionIdByKey.set(key, sessionId);
        sessions.push({
          id: sessionId,
          gym_id: ctx.gymId,
          name: slot.className,
          class_type_id: slot.classTypeId,
          recurrence_id: slot.recurrenceId,
          starts_at: startsAt,
          duration_minutes: slot.durationMinutes,
          capacity: slot.capacity,
          coach_id: ctx.coachIds[coachCursor++ % ctx.coachIds.length],
          created_by: ctx.ownerId,
        });
      }
      const pair = `${sessionId}@${a.memberId}`;
      if (bookedPairs.has(pair)) {
        skippedExistingBookings += 1;
        continue;
      }
      bookedPairs.add(pair);
      const startMs = Date.parse(startsAt);
      const marker = ctx.coachIds[0] ?? ctx.ownerId;
      bookings.push({
        id: ctx.uuid(),
        gym_id: ctx.gymId,
        class_session_id: sessionId,
        profile_id: a.memberId,
        created_at: new Date(startMs - (2 + Math.floor(ctx.rng() * 94)) * 3_600_000).toISOString(),
        attended_at: a.attended ? new Date(startMs + 4 * 60_000).toISOString() : null,
        marked_by: marker,
        no_show: !a.attended,
        no_show_marked_at: a.attended ? null : new Date(startMs + 30 * 60_000).toISOString(),
      });
    }

    for (const profileId of day.paymentFailures) {
      const subId = ctx.subscriptionByProfile.get(profileId);
      if (!subId) continue;
      const prev = failures.get(subId);
      if (prev) {
        prev.last = dateISO;
        prev.count += 1;
      } else {
        failures.set(subId, { first: dateISO, last: dateISO, count: 1 });
      }
    }
  }

  let failuresWithoutSubscription = 0;
  for (const day of days) {
    for (const profileId of day.paymentFailures) {
      if (!ctx.subscriptionByProfile.has(profileId)) failuresWithoutSubscription += 1;
    }
  }

  const dunning: DunningUpsert[] = [...failures.entries()].map(([subId, f]) => {
    const profileId = [...ctx.subscriptionByProfile.entries()].find(([, s]) => s === subId)![0];
    return {
      plan_subscription_id: subId,
      profile_id: profileId,
      gym_id: ctx.gymId,
      past_due_since: localToUtc(f.first, '09:00', ctx.tz),
      payment_failure_count: f.count,
      last_payment_error: 'Card declined.',
      // A week out: recent failures are chase-eligible (attempt still
      // ahead), stale ones read as Stripe mid-retry and stay quiet —
      // never null, which would put words in Stripe's mouth ("gave up")
      // the sim has no basis for.
      next_payment_attempt: localToUtc(isoDateOffset(f.last, 7), '09:00', ctx.tz),
    };
  });

  return { sessions, bookings, dunning, skippedExistingBookings, failuresWithoutSubscription };
}

export type SlotPrediction = {
  label: string;
  earlier: SlotSummary | null;
  recent: SlotSummary | null;
  wouldFire: boolean;
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// What the sim expects agent_class_return_tick to conclude, so the run
// can print prediction next to outcome and a disagreement is visible.
// The tick splits at a timestamp (now() - 28 days) and this splits at a
// calendar date, so a slot sitting exactly on the boundary can land a
// session on different sides — one session of drift near the split is
// the boundary, not a bug.
export function predictClassReturn(
  days: SimDay[],
  slots: SlotDef[],
  todayISO: string,
  windowStartISO: string,
): SlotPrediction[] {
  const recentStart = daysBetween(windowStartISO, isoDateOffset(todayISO, -28));
  const earlier = summariseSlots(days.filter((d) => d.dayIndex < recentStart));
  const recent = summariseSlots(days.filter((d) => d.dayIndex >= recentStart));
  const byId = (list: SlotSummary[]) => new Map(list.map((s) => [s.sessionId, s]));
  const earlierBy = byId(earlier);
  const recentBy = byId(recent);
  return slots
    .map((slot) => {
      const id = `${slot.recurrenceId}@${slot.dow}@${slot.time}`;
      const e = earlierBy.get(id) ?? null;
      const r = recentBy.get(id) ?? null;
      return {
        label: `${slot.className} ${DAY_NAMES[slot.dow]} ${slot.time}`,
        earlier: e,
        recent: r,
        wouldFire: e !== null && r !== null && wouldFireClassReturn(e, r),
      };
    })
    .filter((p) => p.earlier !== null || p.recent !== null);
}

export function runSimulation(
  cast: SimMember[],
  simSessions: SimSession[],
  totalDays: number,
  rng: Rng,
): SimDay[] {
  const days: SimDay[] = [];
  for (let d = 0; d < totalDays; d += 1) {
    days.push(simulateDay(d, cast, simSessions, rng));
  }
  return days;
}
