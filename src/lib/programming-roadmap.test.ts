import { describe, expect, it } from 'vitest';

import {
  blockForDate,
  blockRangeText,
  blockStripText,
  blockWeekInfo,
  yearLanes,
  type ProgrammingBlock,
} from './programming-roadmap';

function mk(partial: Partial<ProgrammingBlock>): ProgrammingBlock {
  return {
    id: 'b1',
    gym_id: 'g1',
    name: 'Squat strength',
    starts_on: '2027-01-06',
    ends_on: '2027-02-28',
    color: '#3B82F6',
    note: null,
    created_by: 'u1',
    created_at: '2027-01-01T00:00:00Z',
    ...partial,
  };
}

describe('blockForDate', () => {
  it('finds the covering block and returns null outside any', () => {
    const b = mk({});
    expect(blockForDate([b], '2027-01-20')?.id).toBe('b1');
    expect(blockForDate([b], '2027-03-01')).toBeNull();
  });

  it('overlaps resolve to the latest-starting block', () => {
    const a = mk({ id: 'a', starts_on: '2027-01-01', ends_on: '2027-03-31' });
    const b = mk({ id: 'b', starts_on: '2027-02-01', ends_on: '2027-02-14' });
    expect(blockForDate([a, b], '2027-02-07')?.id).toBe('b');
  });
});

describe('blockWeekInfo + strip text', () => {
  it('counts weeks from the start date', () => {
    const b = mk({});
    expect(blockWeekInfo(b, '2027-01-06')).toEqual({ week: 1, weeks: 8 });
    expect(blockWeekInfo(b, '2027-01-20')).toEqual({ week: 3, weeks: 8 });
    expect(blockStripText(b, '2027-01-20')).toBe('Squat strength · week 3 of 8');
  });

  it('single-week blocks skip the counter', () => {
    const b = mk({ starts_on: '2027-04-05', ends_on: '2027-04-11', name: 'Deload' });
    expect(blockStripText(b, '2027-04-07')).toBe('Deload');
  });
});

describe('yearLanes', () => {
  it('positions blocks proportionally and clips to the year', () => {
    const inYear = mk({});
    const spanning = mk({
      id: 'x',
      starts_on: '2026-12-01',
      ends_on: '2027-01-15',
    });
    const lanes = yearLanes([inYear, spanning], 2027);
    expect(lanes.map((l) => l.block.id)).toEqual(['x', 'b1']);
    expect(lanes[0].leftPct).toBe(0);
    expect(lanes[1].leftPct).toBeGreaterThan(0);
    const other = yearLanes([mk({ starts_on: '2025-01-01', ends_on: '2025-02-01' })], 2027);
    expect(other).toEqual([]);
  });
});

describe('blockRangeText', () => {
  it('speaks the range with its week count', () => {
    expect(blockRangeText(mk({}))).toBe('6 Jan – 28 Feb · 8 weeks');
  });
});
