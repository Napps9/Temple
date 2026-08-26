// The gym's own clock, and the hours it is decent to reach somebody.
//
// Lifted out of send-agent-messages (0206), which had it file-private,
// when member texts arrived and needed exactly the same rule. A message
// deferred to the morning is the whole point: an owner who taps "Yes,
// send it" at 10pm should not be refused, and a member who logs a 6am
// lift should not be texted about it at 6.40.

const QUIET_FROM_HOUR = 20; // 8pm — nothing goes out at or after this
const QUIET_UNTIL_HOUR = 9; // 9am — nothing goes out before this

export function gymLocalHour(timezone: string, now: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now);
    return Number(s);
  } catch {
    // A junk timezone string must not stop the queue draining forever;
    // gyms.timezone is free text with no CHECK.
    return now.getUTCHours();
  }
}

export function inQuietHours(timezone: string, now: Date = new Date()): boolean {
  const hour = gymLocalHour(timezone ?? 'Europe/London', now);
  return hour < QUIET_UNTIL_HOUR || hour >= QUIET_FROM_HOUR;
}
