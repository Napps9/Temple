import { describe, expect, it } from 'vitest';

import {
  formatRatio,
  heavyShareVerdict,
  pushPullVerdict,
  topTimeDomainVerdict,
} from './programming-verdicts';

// ---------- formatRatio ----------

describe('formatRatio', () => {
  it('normalises the dominant side against 1', () => {
    expect(formatRatio(12, 10)).toBe('1.2 : 1');
    expect(formatRatio(10, 13)).toBe('1 : 1.3');
    expect(formatRatio(10, 10)).toBe('1 : 1');
  });

  it('keeps zero sides literal instead of dividing by them', () => {
    expect(formatRatio(5, 0)).toBe('5 : 0');
    expect(formatRatio(0, 4)).toBe('0 : 4');
  });

  it('drops trailing .0', () => {
    expect(formatRatio(20, 10)).toBe('2 : 1');
  });
});

// ---------- pushPullVerdict ----------

describe('pushPullVerdict', () => {
  it('is ok while the displayed dominant ratio is at most 1.2 : 1, either way round', () => {
    expect(pushPullVerdict({ push: 12, pull: 10 })?.ok).toBe(true);
    expect(pushPullVerdict({ push: 10, pull: 12 })?.ok).toBe(true);
    expect(pushPullVerdict({ push: 10, pull: 10 })?.ok).toBe(true);
  });

  it('never shows green with an amber-looking value: 10:8 displays 1.3 : 1 and flags', () => {
    const v = pushPullVerdict({ push: 10, pull: 8 });
    expect(v?.value).toBe('1.3 : 1');
    expect(v?.ok).toBe(false);
    expect(v?.caption).toContain('push-heavy');
  });

  it('flags drift in both directions and names it', () => {
    expect(pushPullVerdict({ push: 15, pull: 10 })?.caption).toContain(
      'push-heavy',
    );
    expect(pushPullVerdict({ push: 10, pull: 15 })?.caption).toContain(
      'pull-heavy',
    );
  });

  it('handles a zero side without dividing by it', () => {
    const v = pushPullVerdict({ push: 6, pull: 0 });
    expect(v?.value).toBe('6 : 0');
    expect(v?.ok).toBe(false);
    expect(v?.caption).toContain('push-heavy');
  });

  it('returns null with no push or pull work at all', () => {
    expect(pushPullVerdict({ push: 0, pull: 0 })).toBeNull();
  });

  it('carries the underlying counts in the caption', () => {
    expect(pushPullVerdict({ push: 12, pull: 10 })?.caption).toBe(
      'in balance · 12 push / 10 pull',
    );
    expect(pushPullVerdict({ push: 15, pull: 10 })?.caption).toBe(
      'push-heavy · 15 push / 10 pull',
    );
  });
});

// ---------- topTimeDomainVerdict ----------

function domain(key: string, count: number, pct: number, short?: string) {
  return { key, label: key, short, count, pct };
}

describe('topTimeDomainVerdict', () => {
  it('picks the biggest bucket, prefers its short label, and counts the pieces', () => {
    const v = topTimeDomainVerdict([
      domain('5to10', 8, 24),
      domain('10to15', 12, 36, '10–15'),
      domain('over20', 13, 40),
    ]);
    expect(v?.value).toBe('over20');
    expect(v?.ok).toBe(true);
    expect(v?.caption).toBe('40% of 33 conditioning pieces');
    const short = topTimeDomainVerdict([domain('10to15', 3, 100, '10–15')]);
    expect(short?.value).toBe('10–15');
  });

  it('is ok at exactly 50% and flags at 51%, with counts either way', () => {
    expect(
      topTimeDomainVerdict([domain('a', 5, 50), domain('b', 5, 50)])?.ok,
    ).toBe(true);
    const over = topTimeDomainVerdict([
      domain('a', 21, 51),
      domain('b', 20, 49),
    ]);
    expect(over?.ok).toBe(false);
    expect(over?.caption).toBe('51% of 41 — one domain dominates');
  });

  it('keeps the earlier bucket on a tie and returns null on empty', () => {
    const v = topTimeDomainVerdict([
      domain('under5', 5, 50),
      domain('over20', 5, 50),
    ]);
    expect(v?.value).toBe('under5');
    expect(topTimeDomainVerdict([domain('under5', 0, 0)])).toBeNull();
  });
});

// ---------- heavyShareVerdict ----------

function load(level: string, count: number, pct: number) {
  return { level, count, pct };
}

describe('heavyShareVerdict', () => {
  it('is ok inside 20–40% of loaded pieces, inclusive', () => {
    expect(
      heavyShareVerdict([load('heavy', 2, 0), load('moderate', 8, 0)])?.ok,
    ).toBe(true);
    expect(
      heavyShareVerdict([load('heavy', 4, 0), load('light', 6, 0)])?.ok,
    ).toBe(true);
  });

  it('excludes bodyweight from the denominator', () => {
    // 4 heavy of 10 externally loaded — 40%, ok — even with 90
    // bodyweight sections alongside.
    const v = heavyShareVerdict([
      load('heavy', 4, 4),
      load('moderate', 6, 6),
      load('bodyweight', 90, 90),
    ]);
    expect(v?.value).toBe('40%');
    expect(v?.ok).toBe(true);
  });

  it('flags just outside both edges with counts in the caption', () => {
    const high = heavyShareVerdict([
      load('heavy', 41, 0),
      load('light', 59, 0),
    ]);
    expect(high?.value).toBe('41%');
    expect(high?.ok).toBe(false);
    expect(high?.caption).toBe('41 of 100 — drifting heavy');
    const low = heavyShareVerdict([
      load('heavy', 19, 0),
      load('moderate', 81, 0),
    ]);
    expect(low?.value).toBe('19%');
    expect(low?.ok).toBe(false);
    expect(low?.caption).toBe('19 of 100 — little heavy work');
  });

  it('treats loaded pieces with zero heavy as 0%', () => {
    const v = heavyShareVerdict([load('moderate', 5, 100)]);
    expect(v?.value).toBe('0%');
    expect(v?.ok).toBe(false);
  });

  it('returns null when only bodyweight (or nothing) carried a load level', () => {
    expect(heavyShareVerdict([load('heavy', 0, 0)])).toBeNull();
    expect(heavyShareVerdict([load('bodyweight', 7, 100)])).toBeNull();
  });
});
