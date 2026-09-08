// What the Edit class sheet has to work out before it can call
// edit_session_scoped (0288), kept pure so the awkward parts are tested
// rather than eyeballed in a modal.
//
// The awkward parts are all about the difference between a class and the
// schedule behind it. A single class can move to any day; a series cannot,
// because the pattern's days_of_week decide which days it fires on. A
// series' time change is a SHIFT applied to every time the pattern holds,
// so editing a 06:00 in a schedule that also runs 17:30 moves both — that
// is bulk_edit_sessions' meaning and the chat action's, so it is the
// product's existing behaviour rather than a new one, but it has to be said
// out loud before somebody saves it.

import { wallTimeToEpoch } from './zoned-time';

export type EditScope = 'one' | 'from' | 'series';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ---------------------------------------------------------------------------
// Describing a repeating schedule. Shared with CancelClassDialog, which
// asks the operator the same question about the same pattern — two copies
// of "Weekdays at 06:00" is how two dialogs end up disagreeing about the
// same series.
// ---------------------------------------------------------------------------

// Same order PostgreSQL hands back in class_recurrences.days_of_week,
// where 0 is Sunday.
const DAY_LABELS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

export function fmtDays(days: number[]): string {
  if (days.length === 0) return '';
  if (days.length === 7) return 'Every day';
  const set = new Set(days);
  const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d));
  if (isWeekdays) return 'Weekdays';
  const isWeekends = days.length === 2 && set.has(0) && set.has(6);
  if (isWeekends) return 'Weekends';
  const sorted = [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]);
  if (sorted.length === 1) return sorted[0]!;
  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]}`;
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

export function fmtTimes(times: string[]): string {
  if (times.length === 0) return '';
  if (times.length === 1) return `at ${times[0]}`;
  if (times.length === 2) return `at ${times[0]} and ${times[1]}`;
  return `at ${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

export function fmtPattern(days: number[], times: string[]): string {
  return [fmtDays(days), fmtTimes(times)].filter(Boolean).join(' ');
}

export function fmtEnds(endsOn: string | null): string {
  if (!endsOn) return '';
  const d = new Date(endsOn);
  const label = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return ` · ends ${label}`;
}

export function fmtSessionWhen(startsAt: string, durationMinutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const date = start.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const t = (d: Date) =>
    `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  return `${date}, ${t(start)}–${t(end)}`;
}

// ---------------------------------------------------------------------------
// The shift, mirrored from _shift_class_times (0170).
// ---------------------------------------------------------------------------

function minutesOf(time: string): number | null {
  if (!TIME_RE.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// null when any time would leave its day, which is the case the server
// refuses: it would change which days_of_week the pattern fires on, and the
// sheet should say so before somebody presses Save rather than after.
export function shiftTimes(times: string[], shift: number): string[] | null {
  if (shift === 0) return times;
  const out: string[] = [];
  for (const t of times) {
    const base = minutesOf(t);
    if (base === null) return null;
    const next = base + shift;
    if (next < 0 || next >= 1440) return null;
    out.push(timeOf(next));
  }
  return out;
}

// The honesty note for a schedule with more than one time a day. Returns
// null when there is nothing surprising to say — one time, or no move.
export function otherTimesNote(
  times: string[],
  anchorTime: string,
  shift: number,
): string | null {
  if (shift === 0 || times.length < 2) return null;
  const shifted = shiftTimes(times, shift);
  if (!shifted) return null;
  const others = times
    .map((t, i) => [t, shifted[i]!] as const)
    .filter(([t]) => t !== anchorTime);
  if (others.length === 0) return null;
  const parts = others.map(([from, to]) => `${from} to ${to}`);
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This schedule runs more than once a day, so it also moves ${list}.`;
}

// ---------------------------------------------------------------------------
// Turning two drafts into RPC arguments.
// ---------------------------------------------------------------------------

export type EditDraft = {
  classTypeId: string;
  coachId: string | null;
  dateIso: string;
  time: string;
  duration: string;
  capacity: string;
  location: string;
  notes: string;
};

export type EditArgs = {
  p_session_id: string;
  p_scope: EditScope;
  p_starts_at: string | null;
  p_duration: number | null;
  p_capacity: number | null;
  p_class_type_id: string | null;
  p_coach_id: string | null;
  p_clear_coach: boolean;
  p_location: string | null;
  p_clear_location: boolean;
  p_notes: string | null;
  p_clear_notes: boolean;
};

function parseIsoDate(iso: string): [number, number, number] | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return [y, m, d];
}

export function buildEditArgs(input: {
  sessionId: string;
  scope: EditScope;
  tz: string;
  original: EditDraft;
  draft: EditDraft;
  patternTimes?: string[];
}): { args: EditArgs } | { problem: string } {
  const { sessionId, scope, tz, original, draft } = input;

  const date = parseIsoDate(draft.dateIso);
  if (!date) return { problem: 'That date is not a date.' };
  const mins = minutesOf(draft.time);
  if (mins === null) return { problem: 'Give the start time as HH:MM, like 06:30.' };

  const movedDay = draft.dateIso !== original.dateIso;
  const movedTime = draft.time !== original.time;

  if (scope !== 'one' && movedDay) {
    return {
      problem:
        'A series keeps its days. To move one class to another day, choose “Just this one”.',
    };
  }

  // Bounds first, and the same ones the RPC holds, so the sheet never sends
  // a save it already knows will be refused.
  const duration = Number(draft.duration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    return { problem: 'A class runs between 5 minutes and 8 hours.' };
  }
  const capacity = Number(draft.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { problem: 'Capacity is at least 1.' };
  }

  if (scope !== 'one' && movedTime && input.patternTimes?.length) {
    const shift = mins - (minutesOf(original.time) ?? mins);
    if (!shiftTimes(input.patternTimes, shift)) {
      return {
        problem:
          'That would push one of this schedule’s times past midnight, which would change the days it runs on.',
      };
    }
  }

  const startsAt =
    movedDay || movedTime
      ? new Date(
          wallTimeToEpoch(date[0], date[1], date[2], Math.floor(mins / 60), mins % 60, tz),
        ).toISOString()
      : null;

  const location = draft.location.trim();
  const notes = draft.notes.trim();
  const wasLocation = original.location.trim();
  const wasNotes = original.notes.trim();

  const args: EditArgs = {
    p_session_id: sessionId,
    p_scope: scope,
    p_starts_at: startsAt,
    p_duration: duration === Number(original.duration) ? null : duration,
    p_capacity: capacity === Number(original.capacity) ? null : capacity,
    p_class_type_id:
      draft.classTypeId && draft.classTypeId !== original.classTypeId
        ? draft.classTypeId
        : null,
    // A coach is cleared, set, or left alone, and null cannot say all three.
    p_coach_id:
      draft.coachId && draft.coachId !== original.coachId ? draft.coachId : null,
    p_clear_coach: !draft.coachId && !!original.coachId,
    p_location: location && location !== wasLocation ? location : null,
    p_clear_location: !location && !!wasLocation,
    p_notes: notes && notes !== wasNotes ? notes : null,
    p_clear_notes: !notes && !!wasNotes,
  };

  const changed =
    args.p_starts_at !== null ||
    args.p_duration !== null ||
    args.p_capacity !== null ||
    args.p_class_type_id !== null ||
    args.p_coach_id !== null ||
    args.p_clear_coach ||
    args.p_location !== null ||
    args.p_clear_location ||
    args.p_notes !== null ||
    args.p_clear_notes;
  if (!changed) return { problem: 'Nothing has changed yet.' };

  return { args };
}

// ---------------------------------------------------------------------------
// Saying what happened.
// ---------------------------------------------------------------------------

export type EditResult = {
  updated: number;
  skipped_overbooked: number;
  skipped_past: number;
  skipped_conflict: number;
  notified: number;
  schedule: 'none' | 'updated' | 'split' | 'unchanged';
};

// One sentence per thing that happened, in the order an operator cares:
// what changed, what did not and why, who was told, and what became of the
// repeating schedule — that last one because a pattern left alone will put
// the classes back the next time somebody edits the schedule, and finding
// that out later is the whole reason 0170 reports it.
export function describeEditResult(r: EditResult): string[] {
  const lines: string[] = [];
  lines.push(
    r.updated === 0
      ? 'Nothing changed.'
      : r.updated === 1
        ? 'That class is updated.'
        : `${r.updated} classes are updated.`,
  );
  if (r.skipped_overbooked > 0) {
    lines.push(
      r.skipped_overbooked === 1
        ? 'One was left alone — more members are booked into it than the new capacity.'
        : `${r.skipped_overbooked} were left alone — more members are booked into them than the new capacity.`,
    );
  }
  if (r.skipped_conflict > 0) {
    lines.push(
      r.skipped_conflict === 1
        ? 'One was left alone — that slot or that coach is already taken.'
        : `${r.skipped_conflict} were left alone — the slot or the coach is already taken.`,
    );
  }
  if (r.skipped_past > 0) {
    lines.push('Classes that have already run were left as they are.');
  }
  if (r.notified > 0) {
    lines.push(
      r.notified === 1
        ? 'One member was told.'
        : `${r.notified} members were told.`,
    );
  }
  if (r.schedule === 'split') {
    lines.push('The repeating schedule now carries this from that day onward.');
  } else if (r.schedule === 'updated') {
    lines.push('The repeating schedule carries this too.');
  } else if (r.schedule === 'unchanged') {
    lines.push(
      'The repeating schedule was left alone, because not every class could take the change — so editing the schedule later will put these back.',
    );
  }
  return lines;
}
