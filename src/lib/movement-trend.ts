import type { JournalRow } from './movement-journal';
import type { Metric } from './movements';

export type TrendPoint = {
  t: number; // performed_at epoch ms
  v: number; // value: numeric for non-time schemes, seconds for time
};

// Chronological points (oldest first) for a single scheme. Filters to
// the scheme's track_key and the metric-appropriate value column,
// dropping rows with no value. Used by the sparkline; the caller
// already knows the scheme's `better` direction for tinting.
export function trendPoints(
  rows: JournalRow[],
  trackKey: string,
  metric: Metric,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const r of rows) {
    if (r.track_key !== trackKey) continue;
    const v = metric === 'time' ? r.value_seconds : r.value_numeric;
    if (v == null) continue;
    points.push({ t: new Date(r.performed_at).getTime(), v });
  }
  return points.sort((a, b) => a.t - b.t);
}

// Normalise a series into 0..1 y-positions where 1 is always "best".
// For lower-is-better schemes (time) we invert so an improving series
// still trends upward visually. A flat series maps to a mid-line.
export function normaliseForPlot(
  points: TrendPoint[],
  better: 'higher' | 'lower',
): number[] {
  if (points.length === 0) return [];
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v) => {
    if (span === 0) return 0.5;
    const frac = (v - min) / span; // 0 = min, 1 = max
    return better === 'higher' ? frac : 1 - frac;
  });
}
