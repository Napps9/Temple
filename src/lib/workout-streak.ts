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
