// The day-paged Timeline's cursor arithmetic (day-pager build). One
// dayKey ('YYYY-MM-DD') names a page; these helpers move it, bound it,
// and classify it. All of it is device-local time, deliberately: the
// stream's day grouping (localDayKey / groupTimelineByDay in
// src/lib/timeline.ts) is device-local, and a pager that disagreed with
// the group labels would show "Yesterday" events on the wrong page.
// Gym-timezone paging is a documented non-goal for v1.

export type DayPage = {
  key: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Same shape as timeline.ts's localDayKey, exported for the pager.
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local midnight at the start of the day. Built from parts, not by
// arithmetic on epoch millis, so a DST fold inside the day cannot shift
// the boundary.
export function dayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Local midnight of the following day. Date(y, m, d + 1) rolls months
// and years natively and stays correct across DST transitions.
export function nextDayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d + 1);
}

export function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d + delta));
}

// Keys are ISO-date-shaped, so string order IS date order.
export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clampDayKey(key: string, floor: string, ceiling: string): string {
  if (key < floor) return floor;
  if (key > ceiling) return ceiling;
  return key;
}

// The reachable range: nothing in any feed branch can predate the gym
// row (every source table FKs gym_id), and recurring classes only exist
// as rows out to the materialisation horizon — beyond it a future page
// would be an empty promise, so the pager stops where the data does.
export function pagerBounds(
  gymCreatedAt: string,
  horizonWeeks: number,
  now: Date = new Date(),
): { floor: string; ceiling: string } {
  const weeks = Number.isFinite(horizonWeeks) && horizonWeeks > 0 ? horizonWeeks : 12;
  return {
    floor: dayKeyOf(new Date(gymCreatedAt)),
    ceiling: shiftDayKey(dayKeyOf(now), Math.trunc(weeks) * 7),
  };
}

export function classifyDay(key: string, now: Date = new Date()): DayPage {
  const today = dayKeyOf(now);
  return {
    key,
    isToday: key === today,
    isPast: key < today,
    isFuture: key > today,
  };
}

// A day with nothing to say, said in the register.
export const QUIET_PAST_DAY =
  'A quiet day — nothing happened that was worth keeping.';
export const QUIET_FUTURE_DAY = 'Nothing on the books yet.';
