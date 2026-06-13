import { describe, expect, it } from 'vitest';

import type { JournalRow } from './movement-journal';
import { normaliseForPlot, trendPoints, type TrendPoint } from './movement-trend';

function row(
  partial: Partial<JournalRow> & {
    id: string;
    track_key: string;
    performed_at: string;
  },
): JournalRow {
  return {
    source: 'direct',
    movement_key: 'back_squat',
    workout_id: null,
    section_title: null,
    value_numeric: null,
    value_seconds: null,
    value_unit: null,
    notes: null,
    ...partial,
  } as JournalRow;
}

describe('trendPoints', () => {
  it('filters by track_key and sorts oldest-first', () => {
    const rows = [
      row({ id: 'a', track_key: '1rm', performed_at: '2026-03-01T00:00:00Z', value_numeric: 110 }),
      row({ id: 'b', track_key: '1rm', performed_at: '2026-01-01T00:00:00Z', value_numeric: 100 }),
      row({ id: 'c', track_key: '5rm', performed_at: '2026-02-01T00:00:00Z', value_numeric: 80 }),
    ];
    const pts = trendPoints(rows, '1rm', 'weight');
    expect(pts.map((p) => p.v)).toEqual([100, 110]);
  });

  it('uses value_seconds for time schemes and drops null values', () => {
    const rows = [
      row({ id: 'a', track_key: 'for_time', performed_at: '2026-01-01T00:00:00Z', value_seconds: 600 }),
      row({ id: 'b', track_key: 'for_time', performed_at: '2026-02-01T00:00:00Z', value_seconds: null }),
      row({ id: 'c', track_key: 'for_time', performed_at: '2026-03-01T00:00:00Z', value_seconds: 540 }),
    ];
    const pts = trendPoints(rows, 'for_time', 'time');
    expect(pts.map((p) => p.v)).toEqual([600, 540]);
  });
});

describe('normaliseForPlot', () => {
  const pts = (vals: number[]): TrendPoint[] =>
    vals.map((v, i) => ({ t: i, v }));

  it('higher-better maps max to 1, min to 0', () => {
    expect(normaliseForPlot(pts([100, 105, 110]), 'higher')).toEqual([0, 0.5, 1]);
  });

  it('lower-better inverts so improvement trends up', () => {
    // Times getting faster (600 → 540) should rise on the plot.
    expect(normaliseForPlot(pts([600, 570, 540]), 'lower')).toEqual([0, 0.5, 1]);
  });

  it('flat series maps to the mid-line', () => {
    expect(normaliseForPlot(pts([90, 90, 90]), 'higher')).toEqual([0.5, 0.5, 0.5]);
  });

  it('empty input returns empty', () => {
    expect(normaliseForPlot([], 'higher')).toEqual([]);
  });
});
