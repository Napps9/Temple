import { describe, expect, it } from 'vitest';

import {
  bestOf,
  formatPace,
  formatResultValue,
  formatSeconds,
  paceIntervalForText,
  parseDuration,
  type TrackedResultRow,
} from './track';

function row(
  partial: Partial<TrackedResultRow> &
    Pick<TrackedResultRow, 'value_numeric' | 'value_seconds'>,
): TrackedResultRow {
  return {
    id: partial.id ?? 'r',
    workout_id: partial.workout_id ?? 'w',
    movement_key: partial.movement_key ?? 'back_squat',
    track_key: partial.track_key ?? '1rm',
    value_numeric: partial.value_numeric,
    value_seconds: partial.value_seconds,
    value_unit: partial.value_unit ?? null,
    notes: partial.notes ?? null,
    performed_at: partial.performed_at ?? '2026-06-01T12:00:00Z',
  };
}

describe('parseDuration', () => {
  it('parses MM:SS', () => {
    expect(parseDuration('4:32')).toBe(272);
    expect(parseDuration('0:45')).toBe(45);
  });
  it('parses HH:MM:SS', () => {
    expect(parseDuration('1:02:03')).toBe(3723);
  });
  it('parses raw seconds', () => {
    expect(parseDuration('90')).toBe(90);
  });
  it('rejects bad input', () => {
    expect(parseDuration('')).toBe(null);
    expect(parseDuration('abc')).toBe(null);
    expect(parseDuration('4:60')).toBe(null); // seconds out of range
    expect(parseDuration('1:99:00')).toBe(null); // minutes out of range
    expect(parseDuration('1:2:3:4')).toBe(null);
  });
});

describe('formatSeconds', () => {
  it('formats sub-hour as M:SS', () => {
    expect(formatSeconds(45)).toBe('0:45');
    expect(formatSeconds(272)).toBe('4:32');
  });
  it('formats >= 1h as H:MM:SS', () => {
    expect(formatSeconds(3723)).toBe('1:02:03');
    expect(formatSeconds(7200)).toBe('2:00:00');
  });
  it('handles edge cases', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(-5)).toBe('0:00');
  });
});

describe('formatPace', () => {
  it('derives /500m erg pace', () => {
    // 5,000 m in 20:00 → 2:00 per 500 m.
    expect(formatPace(5000, 1200, 500)).toBe('2:00 /500m');
  });
  it('derives /km running pace', () => {
    // 5,000 m in 23:45 → 4:45 per km.
    expect(formatPace(5000, 1425, 1000)).toBe('4:45 /km');
  });
  it('returns null without both positive inputs', () => {
    expect(formatPace(null, 1200, 500)).toBe(null);
    expect(formatPace(5000, null, 500)).toBe(null);
    expect(formatPace(0, 1200, 500)).toBe(null);
    expect(formatPace(5000, 0, 500)).toBe(null);
  });
});

describe('paceIntervalForText', () => {
  it('reads running work in /km', () => {
    expect(paceIntervalForText('20 min max distance run')).toBe(1000);
    expect(paceIntervalForText('Running intervals')).toBe(1000);
  });
  it('defaults erg work to /500m', () => {
    expect(paceIntervalForText('20 min max distance row')).toBe(500);
    expect(paceIntervalForText('Ski erg + assault bike')).toBe(500);
    expect(paceIntervalForText('')).toBe(500);
  });
});

describe('bestOf', () => {
  it('picks highest value when "higher" wins (weight)', () => {
    const rows = [
      row({ value_numeric: 100, value_seconds: null, performed_at: 'a' }),
      row({ value_numeric: 120, value_seconds: null, performed_at: 'b' }),
      row({ value_numeric: 110, value_seconds: null, performed_at: 'c' }),
    ];
    const best = bestOf(rows, { metric: 'weight', better: 'higher' });
    expect(best?.value_numeric).toBe(120);
  });

  it('picks lowest value when "lower" wins (time)', () => {
    const rows = [
      row({ value_numeric: null, value_seconds: 280, performed_at: 'a' }),
      row({ value_numeric: null, value_seconds: 240, performed_at: 'b' }),
      row({ value_numeric: null, value_seconds: 260, performed_at: 'c' }),
    ];
    const best = bestOf(rows, { metric: 'time', better: 'lower' });
    expect(best?.value_seconds).toBe(240);
  });

  it('returns null for empty / all-null series', () => {
    expect(bestOf([], { metric: 'weight', better: 'higher' })).toBe(null);
    const nullRows = [
      row({ value_numeric: null, value_seconds: null }),
      row({ value_numeric: null, value_seconds: null }),
    ];
    expect(bestOf(nullRows, { metric: 'weight', better: 'higher' })).toBe(null);
  });

  it('skips rows missing the right field for the metric', () => {
    // A time-scheme series with a weight-only row mixed in should ignore it.
    const rows = [
      row({ value_numeric: 99, value_seconds: null }),
      row({ value_numeric: null, value_seconds: 300 }),
    ];
    const best = bestOf(rows, { metric: 'time', better: 'lower' });
    expect(best?.value_seconds).toBe(300);
  });
});

describe('formatResultValue', () => {
  it('formats weight with kg fallback', () => {
    expect(
      formatResultValue(
        { value_numeric: 100, value_seconds: null, value_unit: null },
        'weight',
      ),
    ).toBe('100 kg');
  });

  it('honours an explicit unit', () => {
    expect(
      formatResultValue(
        { value_numeric: 220, value_seconds: null, value_unit: 'lbs' },
        'weight',
      ),
    ).toBe('220 lbs');
  });

  it('formats time from seconds', () => {
    expect(
      formatResultValue(
        { value_numeric: null, value_seconds: 272, value_unit: null },
        'time',
      ),
    ).toBe('4:32');
  });

  it('formats reps without a trailing unit for raw counts', () => {
    expect(
      formatResultValue(
        { value_numeric: 20, value_seconds: null, value_unit: null },
        'reps',
      ),
    ).toBe('20 reps');
  });

  it('returns null when the relevant field is missing', () => {
    expect(
      formatResultValue(
        { value_numeric: null, value_seconds: null, value_unit: null },
        'weight',
      ),
    ).toBe(null);
    expect(
      formatResultValue(
        { value_numeric: null, value_seconds: null, value_unit: null },
        'time',
      ),
    ).toBe(null);
  });
});
