// Shared metric maths for the staff KPI surfaces.
//
// mirrorRange / pctDelta / ppDelta / pickPrimaryCurrency / dayBefore were
// file-private in management/index.tsx. The finance block on Analysis needs
// the same delta semantics, and a second copy would have drifted the way
// is_revenue_event drifted from the webhook — so they live here and both
// surfaces import them.
//
// monthRange / previousMonthRange are new: DateRangeCta's presets are
// month | quarter | year | 7d | 30d | custom, with no "last month", and
// mirrorRange deliberately mirrors by LENGTH rather than by calendar
// month. A 31-day month mirrored back 31 days lands mid-February, which is
// the right answer for "previous period" and the wrong one for "last
// month".

import type { Delta, DeltaDirection } from '@/components/StatTile';

export type RevenueRow = {
  currency: string;
  gross_cents: number;
  charge_count: number;
};

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Build the "previous period" — same length as the current range,
// immediately preceding it. Inclusive on both ends.
//
// e.g. current = (2026-06-01, 2026-06-07) — 7 days
//      mirror  = (2026-05-25, 2026-05-31) — 7 days, ending the day before
export function mirrorRange(range: { start: string; end: string }): {
  start: string;
  end: string;
} {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const mirrorEnd = new Date(start.getTime() - 86400000);
  const mirrorStart = new Date(mirrorEnd.getTime() - (days - 1) * 86400000);
  return { start: isoDateUtc(mirrorStart), end: isoDateUtc(mirrorEnd) };
}

// The day before a given period — used as the as-of date for the mirror
// member count, so it's strictly before the current period starts.
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return isoDateUtc(new Date(d.getTime() - 86400000));
}

// The calendar month containing d. Month arithmetic goes through
// Date.UTC(y, m, 1), which normalises the rollovers itself — month 12
// becomes January of the next year, and asking for the 0th of a month
// gives the last day of the one before.
export function monthRange(d: Date): { start: string; end: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    start: isoDateUtc(new Date(Date.UTC(y, m, 1))),
    end: isoDateUtc(new Date(Date.UTC(y, m + 1, 0))),
  };
}

export function previousMonthRange(d: Date): { start: string; end: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    start: isoDateUtc(new Date(Date.UTC(y, m - 1, 1))),
    end: isoDateUtc(new Date(Date.UTC(y, m, 0))),
  };
}

// "July 2026" from a YYYY-MM-DD. Read back at UTC noon so the label cannot
// slide a month with the viewer's offset.
export function monthLabel(isoStart: string): string {
  return new Date(`${isoStart}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Pick the dominant currency by charge_count. With no charges yet, fall
// back to the gym's configured currency (which follows its connected
// Stripe account) so the empty tile reads "£0.00" not "US$0.00". Multi-
// currency gyms are rare enough that one tile per gym is the right trade.
export function pickPrimaryCurrency(
  rows: RevenueRow[],
  fallbackCurrency: string,
): RevenueRow {
  if (rows.length === 0)
    return { currency: fallbackCurrency, gross_cents: 0, charge_count: 0 };
  return [...rows].sort((a, b) => b.charge_count - a.charge_count)[0]!;
}

export function pctDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { direction: 'flat', label: 'no change' };
  if (previous === 0) return { direction: 'up', label: 'new' };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < 0.001) return { direction: 'flat', label: '0%' };
  const pct = ratio * 100;
  const direction: DeltaDirection = pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : '';
  return { direction, label: `${sign}${pct.toFixed(1)}%` };
}

export function ppDelta(current: number, previous: number): Delta {
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return { direction: 'flat', label: '0 pp' };
  const direction: DeltaDirection = diff > 0 ? 'up' : 'down';
  const sign = diff > 0 ? '+' : '';
  return { direction, label: `${sign}${diff.toFixed(1)} pp` };
}

// How long a stay lasted, for a tile roughly 150px wide. Days below two
// months, months below two years, then years to one decimal — an
// eleven-month median reading "334 days" is arithmetic, not an answer.
export function formatStay(days: number): string {
  if (days < 60) return `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  if (days < 730) return `${Math.round(days / 30.44)} mo`;
  return `${(days / 365.25).toFixed(1)} yr`;
}

export type Tenure = {
  departed_count: number;
  median_days_left: number | null;
  still_here_count: number;
  still_here_median_days: number | null;
};

// Both halves, always. Reporting only the members who left is the
// survivorship trap — a young gym that has so far lost only the people
// who were never going to stay would read as though nobody lasts.
export function tenureLine(t: Tenure | null | undefined): {
  value: string;
  subtitle: string;
} {
  if (!t) return { value: '—', subtitle: 'no history yet' };
  const here =
    t.still_here_count === 0
      ? 'nobody here yet'
      : t.still_here_median_days === null
        ? `${t.still_here_count} here now`
        : `${t.still_here_count} here, ${formatStay(t.still_here_median_days)} so far`;
  if (t.departed_count === 0 || t.median_days_left === null) {
    return { value: '—', subtitle: here };
  }
  return { value: formatStay(t.median_days_left), subtitle: here };
}
