// Grouping for the reopen picker.
//
// A fortnight of a busy timetable is fifty-odd rows, so the picker ticks a
// day at a time as well as a class at a time. The day boundary is
// local_date, which preview_closure_reopen resolves in the gym's timezone
// — deriving it here from starts_at would put a staff member signed in
// from another country on the wrong day.

export type ReopenSlot = {
  recurrence_id: string;
  starts_at: string;
  local_date: string;
  class_type_name: string;
  duration_minutes: number;
  capacity: number;
};

export type ReopenDay = {
  date: string;
  slots: ReopenSlot[];
};

export const slotKey = (s: Pick<ReopenSlot, 'recurrence_id' | 'starts_at'>) =>
  `${s.recurrence_id}@${s.starts_at}`;

export function groupSlotsByDay(slots: ReopenSlot[]): ReopenDay[] {
  const days = new Map<string, ReopenSlot[]>();
  for (const s of slots) {
    const existing = days.get(s.local_date);
    if (existing) existing.push(s);
    else days.set(s.local_date, [s]);
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, daySlots]) => ({
      date,
      slots: [...daySlots].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    }));
}

export type DayTickState = 'all' | 'some' | 'none';

export function dayTickState(day: ReopenDay, excluded: Set<string>): DayTickState {
  const ticked = day.slots.filter((s) => !excluded.has(slotKey(s))).length;
  if (ticked === 0) return 'none';
  if (ticked === day.slots.length) return 'all';
  return 'some';
}

// Tapping a day header ticks the whole day unless it is already wholly
// ticked, in which case it clears it. A part-ticked day fills rather than
// clears — the tap that got you there was an untick, so the useful next
// move is the other direction.
export function toggleDay(day: ReopenDay, excluded: Set<string>): Set<string> {
  const next = new Set(excluded);
  if (dayTickState(day, excluded) === 'all') {
    for (const s of day.slots) next.add(slotKey(s));
  } else {
    for (const s of day.slots) next.delete(slotKey(s));
  }
  return next;
}

// "Sat 27 Dec" from a plain YYYY-MM-DD. Parsed at UTC noon so the label
// cannot slide a day either way with the viewer's offset.
export function formatDayLabel(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
