import { describe, expect, it } from 'vitest';

import {
  computeMovementTrends,
  memberTrend,
  type Direction,
  type ResultPoint,
} from './analysis';

function pt(
  profile: string,
  movement: string,
  track: string,
  value: number,
  date: string,
): ResultPoint {
  return {
    profile_id: profile,
    movement_key: movement,
    track_key: track,
    value,
    performed_at: date,
  };
}

const higher: (m: string, t: string) => Direction = () => 'higher';
const lower: (m: string, t: string) => Direction = () => 'lower';

describe('memberTrend', () => {
  it('needs at least two points', () => {
    expect(
      memberTrend([{ value: 100, performed_at: '2026-01-01' }], 'higher', 'a'),
    ).toBeNull();
  });

  it('improves when higher-is-better goes up', () => {
    const t = memberTrend(
      [
        { value: 100, performed_at: '2026-01-01' },
        { value: 110, performed_at: '2026-02-01' },
      ],
      'higher',
      'a',
    )!;
    expect(t.trend).toBe('improving');
    expect(t.deltaPct).toBeCloseTo(10);
  });

  it('improves when lower-is-better goes down (faster time)', () => {
    const t = memberTrend(
      [
        { value: 300, performed_at: '2026-01-01' },
        { value: 270, performed_at: '2026-02-01' },
      ],
      'lower',
      'a',
    )!;
    expect(t.trend).toBe('improving');
    expect(t.deltaPct).toBeCloseTo(-10);
  });

  it('declines when lower-is-better goes up', () => {
    const t = memberTrend(
      [
        { value: 300, performed_at: '2026-01-01' },
        { value: 330, performed_at: '2026-02-01' },
      ],
      'lower',
      'a',
    )!;
    expect(t.trend).toBe('declining');
  });

  it('treats sub-threshold wobble as flat', () => {
    const t = memberTrend(
      [
        { value: 100, performed_at: '2026-01-01' },
        { value: 100.2, performed_at: '2026-02-01' },
      ],
      'higher',
      'a',
    )!;
    expect(t.trend).toBe('flat');
  });

  it('sorts by date, not input order', () => {
    const t = memberTrend(
      [
        { value: 120, performed_at: '2026-03-01' },
        { value: 100, performed_at: '2026-01-01' },
      ],
      'higher',
      'a',
    )!;
    expect(t.first).toBe(100);
    expect(t.last).toBe(120);
    expect(t.trend).toBe('improving');
  });

  it('returns null deltaPct from a zero start without crashing', () => {
    const t = memberTrend(
      [
        { value: 0, performed_at: '2026-01-01' },
        { value: 50, performed_at: '2026-02-01' },
      ],
      'higher',
      'a',
    )!;
    expect(t.deltaPct).toBeNull();
    expect(t.trend).toBe('improving');
  });
});

describe('computeMovementTrends', () => {
  it('groups by movement+track and counts trends', () => {
    const points = [
      pt('a', 'back_squat', '1rm', 100, '2026-01-01'),
      pt('a', 'back_squat', '1rm', 110, '2026-02-01'),
      pt('b', 'back_squat', '1rm', 90, '2026-01-01'),
      pt('b', 'back_squat', '1rm', 85, '2026-02-01'),
      pt('a', 'back_squat', '5rm', 80, '2026-01-01'), // single point — excluded
    ];
    const out = computeMovementTrends(points, higher);
    expect(out).toHaveLength(1);
    expect(out[0].movement_key).toBe('back_squat');
    expect(out[0].track_key).toBe('1rm');
    expect(out[0].improving).toBe(1);
    expect(out[0].declining).toBe(1);
    expect(out[0].flat).toBe(0);
    expect(out[0].members).toHaveLength(2);
  });

  it('keeps tracks separate so 1RM and 5RM never mix', () => {
    const points = [
      pt('a', 'deadlift', '1rm', 180, '2026-01-01'),
      pt('a', 'deadlift', '1rm', 190, '2026-02-01'),
      pt('a', 'deadlift', '5rm', 150, '2026-01-15'),
      pt('a', 'deadlift', '5rm', 155, '2026-02-15'),
    ];
    const out = computeMovementTrends(points, higher);
    expect(out).toHaveLength(2);
    const keys = out.map((o) => `${o.movement_key}/${o.track_key}`).sort();
    expect(keys).toEqual(['deadlift/1rm', 'deadlift/5rm']);
  });

  it('orders busiest movements first', () => {
    const points = [
      pt('a', 'row', '2k', 480, '2026-01-01'),
      pt('a', 'row', '2k', 470, '2026-02-01'),
      pt('b', 'row', '2k', 500, '2026-01-01'),
      pt('b', 'row', '2k', 505, '2026-02-01'),
      pt('a', 'bench_press', '1rm', 80, '2026-01-01'),
      pt('a', 'bench_press', '1rm', 85, '2026-02-01'),
    ];
    const out = computeMovementTrends(points, lower);
    expect(out[0].movement_key).toBe('row');
    expect(out[0].members.length).toBe(2);
  });
});
