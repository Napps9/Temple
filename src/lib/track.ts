// Helpers for the Track area: query types, value formatting,
// best-of selection across a series of movement results.

import type { Metric, Scheme } from './movements';

export type TrackedResultRow = {
  id: string;
  workout_id: string;
  movement_key: string;
  track_key: string;
  value_numeric: number | null;
  value_seconds: number | null;
  value_unit: string | null;
  notes: string | null;
  performed_at: string;
};

export type TrackedWorkoutRow = {
  id: string;
  performed_at: string;
  title: string | null;
  notes: string | null;
  class_session_id: string | null;
  results: TrackedResultRow[];
};

// Format a single result for display. Returns null when there's
// nothing recordable (defensive — the form prevents this).
export function formatResultValue(
  row: Pick<TrackedResultRow, 'value_numeric' | 'value_seconds' | 'value_unit'>,
  metric: Metric,
): string | null {
  if (metric === 'time') {
    if (row.value_seconds == null) return null;
    return formatSeconds(row.value_seconds);
  }
  if (row.value_numeric == null) return null;
  const unit = row.value_unit ?? defaultUnit(metric);
  const n = round(row.value_numeric, metric === 'weight' ? 1 : 0);
  return `${n}${unit ? ` ${unit}` : ''}`;
}

export function defaultUnit(metric: Metric): string {
  switch (metric) {
    case 'weight':
      return 'kg';
    case 'distance':
      return 'm';
    case 'calories':
      return 'cal';
    case 'reps':
      return 'reps';
    case 'time':
      return '';
  }
}

// MM:SS for sub-hour, HH:MM:SS for hour+. Drops leading zero on
// minutes so 4:32 stays compact.
export function formatSeconds(total: number): string {
  if (total < 0 || !Number.isFinite(total)) return '0:00';
  const s = Math.round(total);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours}:${pad2(mins)}:${pad2(secs)}`;
  }
  return `${mins}:${pad2(secs)}`;
}

// Parse a user-entered duration. Accepts "MM:SS", "HH:MM:SS", or a
// plain number of seconds. Returns null when the input doesn't parse.
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  for (const p of parts) if (!/^\d+$/.test(p)) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) {
    const [m, s] = nums as [number, number];
    if (s >= 60) return null;
    return m * 60 + s;
  }
  const [h, m, s] = nums as [number, number, number];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

// Pick the best of a series under the scheme's direction (higher /
// lower better). For time-based schemes it compares value_seconds;
// for everything else it compares value_numeric. Ignores nulls.
export function bestOf(
  rows: TrackedResultRow[],
  scheme: Pick<Scheme, 'metric' | 'better'>,
): TrackedResultRow | null {
  let best: TrackedResultRow | null = null;
  let bestVal: number | null = null;
  for (const r of rows) {
    const v = scheme.metric === 'time' ? r.value_seconds : r.value_numeric;
    if (v == null) continue;
    if (bestVal == null) {
      best = r;
      bestVal = v;
      continue;
    }
    const isBetter = scheme.better === 'higher' ? v > bestVal : v < bestVal;
    if (isBetter) {
      best = r;
      bestVal = v;
    }
  }
  return best;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function round(n: number, decimals: number): string {
  const factor = 10 ** decimals;
  const r = Math.round(n * factor) / factor;
  return r.toString();
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
