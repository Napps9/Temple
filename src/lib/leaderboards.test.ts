import { describe, expect, it } from 'vitest';

import {
  formatClassScore,
  formatStrengthValue,
  isRankable,
  ordinal,
  type ClassLeaderboardRow,
  type StrengthLeaderboardRow,
} from './leaderboards';

function classRow(
  partial: Partial<ClassLeaderboardRow>,
): ClassLeaderboardRow {
  return {
    profile_id: 'p',
    display_name: 'A',
    score: 0,
    total_time_seconds: null,
    total_rounds: null,
    total_extra_reps: null,
    did_not_finish: null,
    heaviest_weight: null,
    weight_unit: null,
    section_format: 'for_time',
    performed_at: '2026-06-01T12:00:00Z',
    rank: 1,
    ...partial,
  };
}

function strengthRow(
  partial: Partial<StrengthLeaderboardRow>,
): StrengthLeaderboardRow {
  return {
    profile_id: 'p',
    display_name: 'A',
    value_numeric: null,
    value_seconds: null,
    performed_at: '2026-06-01T12:00:00Z',
    source: 'direct',
    rank: 1,
    ...partial,
  };
}

describe('formatClassScore', () => {
  it('renders for_time as MM:SS', () => {
    expect(
      formatClassScore(classRow({ section_format: 'for_time', total_time_seconds: 272 })),
    ).toBe('4:32');
  });
  it('renders DNF when did_not_finish is true', () => {
    expect(
      formatClassScore(classRow({ section_format: 'for_time', did_not_finish: true })),
    ).toBe('DNF');
  });
  it('renders amrap rounds + extra reps', () => {
    expect(
      formatClassScore(
        classRow({ section_format: 'amrap', total_rounds: 7, total_extra_reps: 5 }),
      ),
    ).toBe('7 rounds + 5 reps');
  });
  it('renders amrap rounds with no extra reps', () => {
    expect(
      formatClassScore(
        classRow({ section_format: 'amrap', total_rounds: 1, total_extra_reps: 0 }),
      ),
    ).toBe('1 round');
  });
  it('renders max_load as weight + unit', () => {
    expect(
      formatClassScore(
        classRow({ section_format: 'max_load', heaviest_weight: 140, weight_unit: 'kg' }),
      ),
    ).toBe('140 kg');
  });
  it('falls back to kg when weight_unit missing', () => {
    expect(
      formatClassScore(
        classRow({ section_format: 'strength_sets', heaviest_weight: 100 }),
      ),
    ).toBe('100 kg');
  });
  it('renders em-dash for no_score / other', () => {
    expect(formatClassScore(classRow({ section_format: 'no_score' }))).toBe('—');
    expect(formatClassScore(classRow({ section_format: 'other' }))).toBe('—');
  });
});

describe('formatStrengthValue', () => {
  it('renders weight in kg', () => {
    expect(formatStrengthValue(strengthRow({ value_numeric: 110 }), 'weight')).toBe(
      '110 kg',
    );
  });
  it('renders time in MM:SS', () => {
    expect(formatStrengthValue(strengthRow({ value_seconds: 245 }), 'time')).toBe(
      '4:05',
    );
  });
  it('renders reps with reps unit', () => {
    expect(formatStrengthValue(strengthRow({ value_numeric: 32 }), 'reps')).toBe(
      '32 reps',
    );
  });
  it('renders em-dash for missing values', () => {
    expect(formatStrengthValue(strengthRow({}), 'weight')).toBe('—');
    expect(formatStrengthValue(strengthRow({}), 'time')).toBe('—');
  });
});

describe('isRankable', () => {
  it('returns false only for no_score and other', () => {
    expect(isRankable('for_time')).toBe(true);
    expect(isRankable('amrap')).toBe(true);
    expect(isRankable('emom')).toBe(true);
    expect(isRankable('no_score')).toBe(false);
    expect(isRankable('other')).toBe(false);
  });
});

describe('ordinal', () => {
  it('handles common cases', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(102)).toBe('102nd');
  });
});
