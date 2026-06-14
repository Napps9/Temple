// Wall-clock-in-a-timezone helpers for the absolute cancel cutoff. The
// server computes the cutoff in the gym's timezone (Postgres AT TIME
// ZONE); the client mirrors it for the late-cancel warning so the UI
// and the refund trigger agree on whether a cancel is late.

// Epoch ms for a wall-clock time (y, mo 1-12, d, h, mi) interpreted in
// `tz`. One-shot offset correction: render the naive-UTC guess in tz,
// measure how far tz sat from UTC at that instant, subtract it. Off by
// an hour only inside the ~1hr/year DST fold, which a forfeit warning
// can tolerate.
export function wallTimeToEpoch(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcGuess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asTz = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = asTz - utcGuess;
  return utcGuess - offset;
}

// Epoch ms of "<time>, <daysBefore> days before the class's local
// date", in `tz`. `time` is 'HH:MM' or 'HH:MM:SS' (Postgres `time`).
export function dayBeforeCutoffEpoch(
  classStartIso: string,
  tz: string,
  daysBefore: number,
  time: string,
): number {
  const start = new Date(classStartIso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(start);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Shift the local date back daysBefore using UTC date math (no tz drift
  // because we only touch the calendar date, not a wall time yet).
  const shifted = new Date(
    Date.UTC(get('year'), get('month') - 1, get('day')) -
      daysBefore * 86_400_000,
  );
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  return wallTimeToEpoch(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    hh,
    mm || 0,
    tz,
  );
}
