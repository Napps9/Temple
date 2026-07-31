import { describe, expect, it } from 'vitest';

import {
  MAX_POINTS,
  barHeights,
  peakIndex,
  toSeries,
  weighRows,
  type DayCount,
} from './answer';

function days(counts: number[], from = '2026-07-01'): DayCount[] {
  const [y, m, d] = from.split('-').map(Number);
  return counts.map((attended, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return { day: dt.toISOString().slice(0, 10), attended };
  });
}

describe('a short series', () => {
  it('draws a week as a bar a day', () => {
    const s = toSeries(days([4, 9, 2, 7, 11, 3, 0]), 'the last week')!;
    expect(s.points).toHaveLength(7);
    expect(s.points.map((p) => p.value)).toEqual([4, 9, 2, 7, 11, 3, 0]);
    // 2026-07-01 is a Wednesday.
    expect(s.points.map((p) => p.label).join('')).toBe('WTFSSMT');
  });

  // Past a fortnight the bars get thinner than the gaps between them in a
  // chat card on a phone, so the run buckets rather than shrinking.
  it('buckets a quarter rather than drawing 90 bars', () => {
    const s = toSeries(days(Array(90).fill(2)), 'the last 90 days')!;
    expect(s.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(s.points.reduce((n, p) => n + p.value, 0)).toBe(180);
  });

  // The bucket width follows the period. A fixed week would make a year
  // 53 buckets, and cutting them to fit would draw the last quarter under
  // a label that says the last year — the chart disagreeing with the
  // number above it.
  it('keeps a whole year in the bars rather than showing its tail', () => {
    const s = toSeries(days(Array(365).fill(1)), 'the last year')!;
    expect(s.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(s.points.reduce((n, p) => n + p.value, 0)).toBe(365);
  });

  // Filled backwards from the most recent day, so any short bucket lands
  // at the start rather than where the eye finishes.
  it('leaves the short bucket at the start, never the end', () => {
    const s = toSeries(days(Array(17).fill(1)), 'seventeen days')!;
    expect(s.points[s.points.length - 1].value).toBe(2);
    expect(s.points[0].value).toBe(1);
  });

  it('has nothing to draw for a period with no days in it', () => {
    expect(toSeries([], 'the last week')).toBeNull();
  });

  it('sorts what it is given, so a caller cannot draw a week backwards', () => {
    const shuffled = [...days([1, 2, 3])].reverse();
    expect(toSeries(shuffled, 'x')!.points.map((p) => p.value)).toEqual([1, 2, 3]);
  });
});

describe('the one bar that gets a label', () => {
  // A number over every bar is chaos and goes unread; the one an owner is
  // looking for is the biggest.
  it('points at the busiest', () => {
    expect(peakIndex([{ label: 'M', value: 3 }, { label: 'T', value: 9 }])).toBe(1);
  });

  it('breaks a tie towards the earlier one, so the answer is stable', () => {
    expect(
      peakIndex([
        { label: 'M', value: 9 },
        { label: 'T', value: 9 },
      ]),
    ).toBe(0);
  });

  // Labelling "0" as the peak of an empty week is worse than saying
  // nothing — the prose already says nobody was marked in.
  it('points at nothing when nobody came all week', () => {
    expect(peakIndex([{ label: 'M', value: 0 }, { label: 'T', value: 0 }])).toBe(-1);
  });
});

describe('bar heights', () => {
  it('scales against the tallest', () => {
    expect(barHeights([
      { label: 'M', value: 5 },
      { label: 'T', value: 10 },
    ])).toEqual([0.5, 1]);
  });

  // A day with nobody in draws as the empty rail. A missing bar reads as
  // a missing day, which is a different claim.
  it('gives an empty day a zero rather than dropping it', () => {
    const h = barHeights([
      { label: 'M', value: 0 },
      { label: 'T', value: 4 },
    ]);
    expect(h).toEqual([0, 1]);
  });

  it('survives a week where nobody came at all', () => {
    expect(barHeights([{ label: 'M', value: 0 }])).toEqual([0]);
  });
});

describe('list rails', () => {
  it('weighs each row against the largest', () => {
    expect(
      weighRows([
        { name: 'CrossFit', detail: '40', value: 40 },
        { name: 'Yoga', detail: '10', value: 10 },
      ]).map((r) => r.weight),
    ).toEqual([1, 0.25]);
  });

  it('does not divide by a zero total', () => {
    expect(weighRows([{ name: 'Yoga', detail: '0', value: 0 }])[0].weight).toBe(0);
  });
});
