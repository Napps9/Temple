// When a scheduled send actually goes.
//
// "Tuesday at 9" means nine o'clock at the gym, and the gym is not
// necessarily where the phone is. A coach on holiday scheduling next
// week's newsletter should not shift it by two hours because they happen
// to be in Greece — so the wall time the owner said is interpreted in
// gyms.timezone, and the label on the card is rendered back in the same
// zone. The two have to agree, because the card is the approval.
//
// Pure and tested here rather than inline in the action: an off-by-a-
// timezone send is invisible until it lands in an inbox at 3am.

import { wallTimeToEpoch } from './zoned-time';

export type WallTime = { y: number; mo: number; d: number; h: number; mi: number };

// A year out. Not a technical limit — a campaign scheduled further away
// than that is a typo in the year, and the dispatcher would sit on it.
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// The model returns the date and the time separately, because a single
// combined string is where timezone assumptions hide: an ISO instant from
// a model is an instant it made up, and a naive datetime looks like one.
export function parseWallTime(date: unknown, time: unknown): WallTime | null {
  if (typeof date !== 'string' || typeof time !== 'string') return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const parts = {
    y: Number(d[1]),
    mo: Number(d[2]),
    d: Number(d[3]),
    h: Number(t[1]),
    mi: Number(t[2]),
  };
  if (parts.mo < 1 || parts.mo > 12 || parts.d < 1 || parts.d > 31) return null;
  if (parts.h > 23 || parts.mi > 59) return null;
  // 31 April parses as 1 May in Date.UTC's arithmetic, which would send a
  // campaign on a day nobody named.
  const probe = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d));
  if (probe.getUTCMonth() !== parts.mo - 1 || probe.getUTCDate() !== parts.d) {
    return null;
  }
  return parts;
}

// The instant, or null if it is behind us or absurdly far ahead. The RPC
// refuses a past time too; this is so the card can say why rather than
// the owner finding out from a Postgres exception.
export function sendAtEpoch(
  w: WallTime,
  tz: string,
  now: number,
): number | null {
  const at = wallTimeToEpoch(w.y, w.mo, w.d, w.h, w.mi, tz);
  if (!Number.isFinite(at)) return null;
  if (at <= now) return null;
  if (at - now > MAX_AHEAD_MS) return null;
  return at;
}

// "Tuesday 4 August at 09:00" — in the gym's zone, spelled out, because
// the whole point of the card is that nobody has to work out what "in 3
// days" meant.
export function sendAtLabel(at: number, tz: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(at));
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
  return `${day} at ${clock}`;
}

// How far off it is, for the second line of the card. A send that is
// forty minutes away and one that is three weeks away deserve different
// amounts of care, and the date alone does not say which this is.
export function untilLabel(at: number, now: number): string {
  const mins = Math.round((at - now) / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

// The campaign editor's free-text field, which people type as
// "2026-08-01 18:30" or paste as "2026-08-01T18:30". Same wall time,
// same zone, same parser as the chat — a scheduled send must not depend
// on which of the two surfaces booked it.
export function parseTypedWallTime(text: string): WallTime | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}:\d{2})/.exec(text.trim());
  return m ? parseWallTime(m[1], m[2]) : null;
}
