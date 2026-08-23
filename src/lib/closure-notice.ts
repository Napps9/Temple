// Copy for the notice the close-gym flow can post alongside a closure.
// Pure so it can be unit-tested; the dates are the closure's literal
// YYYY-MM-DD values (inclusive), parsed as local calendar days — no
// timezone maths, the operator's dates are the message.

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function fmtDay(d: Date, withWeekday: boolean): string {
  return d.toLocaleDateString('en-GB', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
  });
}

// 'Monday 31 August' for one day, '24 to 28 December' inside a month,
// '28 December to 2 January' across months.
export function closureRangePhrase(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return fmtDay(start, true);
  if (
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  ) {
    return `${start.getDate()} to ${fmtDay(end, false)}`;
  }
  return `${fmtDay(start, false)} to ${fmtDay(end, false)}`;
}

export function closureNoticeCopy(
  startIso: string,
  endIso: string,
  reason: string,
): { title: string; body: string } {
  const range = closureRangePhrase(startIso, endIso);
  const r = reason.trim();
  return {
    title: `Closed ${range}`,
    body:
      `The gym is closed ${range}` +
      (r ? ` — ${r.charAt(0).toLowerCase()}${r.slice(1)}` : '') +
      '. Any classes you had booked on these dates are cancelled, and what changed for you is listed below.',
  };
}
