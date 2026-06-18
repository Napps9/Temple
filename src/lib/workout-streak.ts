// Workout-streak: how many consecutive days, ending today, the
// member has logged a workout. Pure so we can test it deterministically.
//
// Rules:
//   - Local-time date boundary (toLocaleDateString in the caller).
//     The helper just takes a Set<string> of "yyyy-mm-dd" days the
//     member logged something on, plus a "today" anchor.
//   - Today not yet logged is allowed: the streak counts back from
//     yesterday so a member's morning visit doesn't tell them the
//     streak ended.
//   - One missed day breaks the streak.

export function localDayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function workoutStreak(loggedDays: Set<string>, today: Date): number {
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);

  // If today hasn't been logged yet, start the walk from yesterday
  // so a member checking their phone before the morning class
  // doesn't see a broken streak.
  if (!loggedDays.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let count = 0;
  while (loggedDays.has(localDayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// Start-of-week day key for a date, honouring the gym's week_starts_on.
function weekStartKey(d: Date, weekStartsOn: 'mon' | 'sun'): string {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const day = x.getDay(); // 0 = Sun
  const diff = weekStartsOn === 'sun' ? -day : day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return localDayKey(x);
}

// Consecutive weeks, ending this week, in which the member logged at
// least one workout. Same "grace" rule as the day streak: a week with
// nothing logged yet doesn't break the count, so an early-week visit
// still shows last week's run. Bounded by the day-set's window (the
// caller loads ~90 days, so this tops out around 13).
export function weekStreak(
  loggedDays: Set<string>,
  today: Date,
  weekStartsOn: 'mon' | 'sun',
): number {
  const weeks = new Set<string>();
  for (const key of loggedDays) {
    const [y, m, d] = key.split('-').map(Number);
    weeks.add(weekStartKey(new Date(y, m - 1, d), weekStartsOn));
  }

  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);
  if (!weeks.has(weekStartKey(cursor, weekStartsOn))) {
    cursor.setDate(cursor.getDate() - 7);
  }

  let count = 0;
  while (weeks.has(weekStartKey(cursor, weekStartsOn))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return count;
}

// Count of distinct days logged in the calendar month containing
// `today` — a simple "sessions this month" tally from the same day-set.
export function sessionsThisMonth(loggedDays: Set<string>, today: Date): number {
  const prefix = `${today.getFullYear()}-${(today.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-`;
  let n = 0;
  for (const key of loggedDays) if (key.startsWith(prefix)) n += 1;
  return n;
}
