// Date-range window arithmetic, mirroring what request_cover_range
// (0164) and close_gym_dates / bulk_edit_sessions (0169) do in Postgres:
// the window runs from local midnight on the start date to local
// midnight on the day AFTER the end date, in the gym's timezone.
// End-exclusive, so "to 3rd January" includes every class on the 3rd
// whatever time it runs.
//
// The preview lists in CoverRangeModal and BulkClassEditModal have to
// agree with their RPCs exactly, or the operator sees one set of classes
// and acts on another.

import { wallTimeToEpoch } from './zoned-time';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export function dateRangeWindow(
  startIso: string,
  endIso: string,
  tz: string,
): { startIso: string; endIso: string } | null {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return null;

  const startEpoch = wallTimeToEpoch(start[0], start[1], start[2], 0, 0, tz);
  // Day after the end date, resolved through UTC so month and year
  // rollovers (3 Jan -> 4 Jan, 31 Dec -> 1 Jan) come out right.
  const dayAfter = new Date(Date.UTC(end[0], end[1] - 1, end[2] + 1));
  const endEpoch = wallTimeToEpoch(
    dayAfter.getUTCFullYear(),
    dayAfter.getUTCMonth() + 1,
    dayAfter.getUTCDate(),
    0,
    0,
    tz,
  );

  return {
    startIso: new Date(startEpoch).toISOString(),
    endIso: new Date(endEpoch).toISOString(),
  };
}

export function validateDateRange(
  startIso: string,
  endIso: string,
  tz: string,
  now: Date,
): string | null {
  if (!ISO_DATE_RE.test(startIso)) return 'Pick a start date';
  if (!ISO_DATE_RE.test(endIso)) return 'Pick an end date';
  const window = dateRangeWindow(startIso, endIso, tz);
  if (!window) return 'That date is not valid';
  if (endIso < startIso) return 'The end date is before the start date';
  if (new Date(window.endIso).getTime() <= now.getTime()) {
    return 'That date range is in the past';
  }
  return null;
}
