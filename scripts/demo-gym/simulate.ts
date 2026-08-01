// A gym that moves.
//
// The demo seeder builds a believable morning and freezes it: agent rows
// are written directly, in the shape a tick writes them, so the demo says
// the same thing on any day. That is right for a demo and exactly wrong
// for finding bugs, because THE JOBS NEVER RUN. Every proposal you look
// at was written by the seeder, not produced by a tick deciding a slot
// had thinned out.
//
// This is the other thing: a day generator. Give it a roster with
// personalities and a timetable, and it produces the events of one day —
// who trained, who booked and did not turn up, whose card failed, who
// joined, who drifted a little further. Run it thirty times and the ticks
// have something real-shaped to read.
//
// PURE ON PURPOSE. Nothing here touches a network or a clock: it takes
// the day and a seeded random source and returns a list of intended
// writes. That makes it testable without a database, and it makes a bad
// month reproducible — the same seed replays the same gym, so "the
// class-return job fired on day 23 and should not have" is a thing you
// can look at twice.
//
// The personalities are the whole design. Uniform random attendance
// produces a gym where nothing ever thins out, nobody ever drifts, and
// every job stays silent forever — which would look like the jobs being
// broken and is really the data having no shape. Real gyms have regulars,
// Tuesday-and-Thursday people, and people quietly on their way out.

export type Personality =
  | 'regular' // 4-5 a week, reliable
  | 'twice_weekly' // two fixed slots, rarely moves
  | 'weekender' // one or two, always at the weekend
  | 'drifting' // was a regular; attendance decaying week by week
  | 'sporadic' // unpredictable, low
  | 'never_started'; // joined, has not been in

export type SimMember = {
  id: string;
  name: string;
  personality: Personality;
  // 0..1, scaled down each week for `drifting` so a fade is gradual
  // rather than a cliff — a cliff is a cancellation, and that is a
  // different event the gym should see differently.
  enthusiasm: number;
  joinedDayIndex: number;
};

export type SimSession = {
  id: string;
  // 0=Sun … 6=Sat, in the gym's own timezone.
  dow: number;
  // 'HH:MM' local.
  at: string;
  capacity: number;
};

export type SimAttendance = {
  sessionId: string;
  memberId: string;
  // A booking that was never honoured. No-shows matter: they are the
  // difference between a class that is full and a class that is busy,
  // and only one of those is a healthy slot.
  attended: boolean;
};

export type SimDay = {
  dayIndex: number;
  attendance: SimAttendance[];
  // Members whose card failed today. Small and rare by design; a gym
  // where a tenth of payments fail every day is a gym nobody would keep
  // using, and it drowns every other signal in the Timeline.
  paymentFailures: string[];
  joined: SimMember[];
  left: string[];
};

// mulberry32: small, fast, and fully determined by its seed. Deliberately
// not Math.random — a simulation you cannot replay is an anecdote.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How likely this person is to be at this slot on this day. The shape
// matters more than the exact numbers: a regular is nearly certain at
// weekday slots, a weekender is nearly certain at weekends and nowhere
// else, and a drifter looks like a regular early and like a ghost later.
export function likelihood(
  m: SimMember,
  session: SimSession,
  weekIndex: number,
): number {
  const weekend = session.dow === 0 || session.dow === 6;
  const base = (() => {
    switch (m.personality) {
      case 'regular':
        return weekend ? 0.25 : 0.7;
      case 'twice_weekly':
        // Two fixed slots. Anything else is close to never, which is what
        // makes a slot's regulars a stable set worth noticing the loss of.
        return session.dow === 2 || session.dow === 4 ? 0.85 : 0.03;
      case 'weekender':
        return weekend ? 0.75 : 0.04;
      case 'drifting':
        // Halves roughly every three weeks. Slow enough that the gym sees
        // a slot thinning before it sees a person gone.
        return (weekend ? 0.2 : 0.6) * Math.pow(0.78, weekIndex);
      case 'sporadic':
        return 0.15;
      case 'never_started':
        return 0;
    }
  })();
  return Math.max(0, Math.min(1, base * m.enthusiasm));
}

const NO_SHOW_RATE = 0.08;

export function simulateDay(
  dayIndex: number,
  members: SimMember[],
  sessions: SimSession[],
  next: () => number,
): SimDay {
  const dow = ((dayIndex % 7) + 7) % 7;
  const weekIndex = Math.floor(dayIndex / 7);
  const today = sessions.filter((s) => s.dow === dow);
  const attendance: SimAttendance[] = [];

  for (const session of today) {
    let booked = 0;
    for (const m of members) {
      if (m.joinedDayIndex > dayIndex) continue;
      if (booked >= session.capacity) break;
      if (next() >= likelihood(m, session, weekIndex)) continue;
      booked += 1;
      attendance.push({
        sessionId: session.id,
        memberId: m.id,
        attended: next() >= NO_SHOW_RATE,
      });
    }
  }

  // Roughly one failure per fortnight across the gym. Rare enough that
  // the money loop's proposals stay meaningful.
  const paymentFailures =
    members.length > 0 && next() < 0.07
      ? [members[Math.floor(next() * members.length)].id]
      : [];

  return { dayIndex, attendance, paymentFailures, joined: [], left: [] };
}

export type SlotSummary = {
  sessionId: string;
  sessions: number;
  attended: number;
  average: number;
};

// What a run of days did to each slot — the same arithmetic
// agent_class_return_tick does, so a simulation can be checked against
// what the job will see before anybody runs a tick.
export function summariseSlots(days: SimDay[]): SlotSummary[] {
  const bySlot = new Map<string, { sessions: Set<number>; attended: number }>();
  for (const day of days) {
    for (const a of day.attendance) {
      const entry = bySlot.get(a.sessionId) ?? { sessions: new Set(), attended: 0 };
      entry.sessions.add(day.dayIndex);
      if (a.attended) entry.attended += 1;
      bySlot.set(a.sessionId, entry);
    }
  }
  return [...bySlot.entries()]
    .map(([sessionId, e]) => ({
      sessionId,
      sessions: e.sessions.size,
      attended: e.attended,
      average: e.sessions.size === 0 ? 0 : e.attended / e.sessions.size,
    }))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

// Would the class-return job see this slot as emptying? The predicate is
// 0246's, restated here so a simulated month can be checked BEFORE it is
// loaded into a database — if no slot in thirty days ever qualifies, the
// simulation is wrong or the thresholds are, and finding out costs
// nothing at this end.
export function wouldFireClassReturn(
  earlier: SlotSummary,
  recent: SlotSummary,
): boolean {
  if (earlier.sessions < 3 || recent.sessions < 3) return false;
  if (earlier.average < 4) return false;
  const drop = earlier.average - recent.average;
  return drop >= Math.max(2, 0.4 * earlier.average);
}
