// "How busy have we been", in sentences.
//
// Pure, because the whole value of the answer is what it refuses to
// claim. Attendance numbers invite two lies that are easy to write by
// accident:
//
//   * a percentage change off a base of four, which reads as a trend and
//     is a coincidence
//   * "your yoga class is dying" from one quiet week
//
// So the comparison is stated only when the earlier period had enough
// people in it to mean something, and the falling-class line only when
// the fall is both large and off a real base.

import type { DayBucket } from './attendance';

export type TypeCount = { name: string; attended: number };

export type Period = {
  attended: number;
  noShow: number;
  // Booked, and neither ticked nor unticked by a coach. Not a member
  // behaviour at all — it is the register nobody took, and it makes
  // `attended` smaller than the truth without making it look wrong.
  unmarked: number;
  types: TypeCount[];
};

export type AttendanceInput = {
  // "the last 7 days", "Saturdays in the last 4 weeks" — written by the
  // caller, which is the only thing that knows what was asked.
  label: string;
  now: Period & { days: DayBucket[] };
  before: Period;
};

// Below this, a period-over-period percentage is arithmetic rather than
// information.
const MEANINGFUL_BASE = 10;
// A class has to have been a real class before it can be said to be
// dying, and has to have lost a third of it.
const DYING_BASE = 6;
const DYING_FALL = 0.33;

function pct(now: number, before: number): number {
  return Math.round(((now - before) / before) * 100);
}

function weekdayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function attendanceAnswer(input: AttendanceInput): {
  title: string;
  lines: string[];
} {
  const { label, now, before } = input;

  if (now.attended === 0 && now.noShow === 0) {
    return {
      title: `Nobody was marked in over ${label}.`,
      lines: [
        'Either nothing ran, or the registers were not taken — attendance only counts what a coach marked.',
      ],
    };
  }

  const lines: string[] = [];

  const busiest = [...now.days].sort(
    (a, b) => b.attended - a.attended || a.day.localeCompare(b.day),
  )[0];
  if (busiest && now.days.length > 1) {
    lines.push(`Busiest was ${weekdayOf(busiest.day)} with ${busiest.attended}.`);
  }

  if (before.attended >= MEANINGFUL_BASE) {
    const change = pct(now.attended, before.attended);
    lines.push(
      change === 0
        ? 'Level with the period before.'
        : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the period before, when it was ${before.attended}.`,
    );
  } else if (before.attended > 0) {
    lines.push(
      `The period before had ${before.attended}, which is too few to read a trend from.`,
    );
  }

  // The split by class used to be written out here — "CrossFit 96, Yoga
  // 19" — and is now drawn as a ranked list above these lines (0243).
  // Saying it twice made the card read as though the numbers disagreed
  // until you checked that they did not.
  const ranked = [...now.types].sort(
    (a, b) => b.attended - a.attended || a.name.localeCompare(b.name),
  );

  // The falling class. Only one, and only when it is real: the point of
  // the line is to send somebody to look at a class, and sending them
  // after noise is worse than saying nothing.
  const beforeByName = new Map(before.types.map((t) => [t.name, t.attended]));
  let worst: { name: string; from: number; to: number } | null = null;
  for (const t of now.types.length > 0 ? now.types : []) {
    const was = beforeByName.get(t.name) ?? 0;
    if (was < DYING_BASE) continue;
    if (t.attended > was * (1 - DYING_FALL)) continue;
    if (!worst || was - t.attended > worst.from - worst.to) {
      worst = { name: t.name, from: was, to: t.attended };
    }
  }
  // A class that ran before and has nobody now never appears in now.types
  // at all, which is the steepest fall there is.
  for (const [name, was] of beforeByName) {
    if (was < DYING_BASE) continue;
    if (now.types.some((t) => t.name === name)) continue;
    if (!worst || was > worst.from - worst.to) {
      worst = { name, from: was, to: 0 };
    }
  }
  if (worst) {
    lines.push(
      worst.to === 0
        ? `${worst.name} had ${worst.from} and now has nobody — worth a look.`
        : `${worst.name} is down from ${worst.from} to ${worst.to} — the biggest fall.`,
    );
  }

  // Said before the no-show line, because it changes how to read every
  // number above it. An owner told "84 came in" who is not told "and 31
  // registers were never taken" has been given a figure they will trust
  // more than it deserves.
  if (now.unmarked > 0) {
    const share = Math.round(
      (now.unmarked / (now.attended + now.noShow + now.unmarked)) * 100,
    );
    lines.push(
      share >= 20
        ? `${now.unmarked} bookings were never marked either way — that is ${share}% of them, so the count above is a floor rather than a total.`
        : `${now.unmarked} bookings were never marked either way.`,
    );
  }

  if (now.noShow > 0) {
    lines.push(
      `${now.noShow} booked in and didn't turn up${
        now.attended > 0 ? ` — ${Math.round((now.noShow / (now.attended + now.noShow)) * 100)}% of the seats taken.` : '.'
      }`,
    );
  }

  return {
    title: `${now.attended} through the door over ${label}.`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Reading the question
// ---------------------------------------------------------------------------

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// "Saturday", "saturdays", "sat" — a model asked for a day of the week
// will send any of them, and an owner typing into the bar will send worse.
export function weekdayIndex(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const want = raw.trim().toLowerCase().replace(/s$/, '');
  if (want.length < 3) return null;
  const i = WEEKDAYS.findIndex((d) => d === want || d.startsWith(want.slice(0, 3)));
  return i >= 0 ? i : null;
}

export function weekdayName(index: number | null): string | null {
  if (index === null || index < 0 || index > 6) return null;
  return WEEKDAYS[index].charAt(0).toUpperCase() + WEEKDAYS[index].slice(1);
}

// The weekday of a YYYY-MM-DD, read as a plain calendar date rather than
// an instant — the day key already came out of the gym's zone, so putting
// it back through a timezone would move it twice.
export function weekdayOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function shiftDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Who has stopped coming
// ---------------------------------------------------------------------------
//
// Two facts the list has to keep apart, because they call for opposite
// conversations: somebody who trained here for a year and stopped, and
// somebody who joined and never once came in. weeksAbsent is null for the
// second rather than a number, and the sentence says so.
//
// "Still paying" leads, because it is the one line that turns a list of
// names into a decision — a member paying for a gym they have stopped
// using is a cancellation that has not happened yet.

export type QuietMember = {
  name: string;
  weeksAbsent: number | null;
  paying: boolean;
};

const NAMES_SHOWN = 6;

export function absenceWindow(weeks: number): string {
  if (weeks === 1) return 'a week';
  if (weeks === 4) return 'a month';
  if (weeks === 52) return 'a year';
  return `${weeks} weeks`;
}

function absence(m: QuietMember): string {
  if (m.weeksAbsent === null) return `${m.name} — never been in`;
  return `${m.name} — ${m.weeksAbsent} week${m.weeksAbsent === 1 ? '' : 's'}`;
}

export function quietAnswer(
  weeks: number,
  rows: QuietMember[],
): { title: string; lines: string[] } {
  const window = absenceWindow(weeks);
  if (rows.length === 0) {
    return {
      title: `Everybody has been in within ${window}.`,
      lines: [],
    };
  }

  const lines: string[] = [];
  const paying = rows.filter((r) => r.paying).length;
  if (paying > 0) {
    lines.push(
      paying === rows.length
        ? `All of them are still paying.`
        : `${paying} of them ${paying === 1 ? 'is' : 'are'} still paying.`,
    );
  }

  const never = rows.filter((r) => r.weeksAbsent === null).length;
  if (never > 0) {
    lines.push(
      `${never} ${never === 1 ? 'has' : 'have'} never been in at all.`,
    );
  }

  lines.push(rows.slice(0, NAMES_SHOWN).map(absence).join('; ') + '.');
  if (rows.length > NAMES_SHOWN) {
    lines.push(`And ${rows.length - NAMES_SHOWN} more.`);
  }

  return {
    title: `${rows.length} ${rows.length === 1 ? 'member has' : 'members have'} not been in for ${window}.`,
    lines,
  };
}
