import { describe, expect, it } from 'vitest';

import { groupByMonth, monthLabel, resultLine } from './journal-directory';

const NOW = new Date(2026, 7, 23);

function section(extras: Record<string, unknown> = {}) {
  return {
    section_format: 'amrap' as const,
    title: null,
    body: null,
    total_time_seconds: null,
    total_rounds: null,
    total_extra_reps: null,
    total_distance_m: null,
    total_calories: null,
    did_not_finish: null,
    free_text_result: null,
    notes: null,
    ...extras,
  };
}

describe('groupByMonth', () => {
  it('groups newest-first rows under month labels, in input order', () => {
    const rows = [
      { performed_at: '2026-08-21T10:00:00Z', id: 'a' },
      { performed_at: '2026-08-03T10:00:00Z', id: 'b' },
      { performed_at: '2026-07-30T10:00:00Z', id: 'c' },
    ];
    const groups = groupByMonth(rows, NOW);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['August', ['a', 'b']],
      ['July', ['c']],
    ]);
  });

  it('names the year only when it is not the current one', () => {
    expect(monthLabel('2026-08-21T10:00:00Z', NOW)).toBe('August');
    expect(monthLabel('2025-12-21T10:00:00Z', NOW)).toBe('December 2025');
  });
});

describe('resultLine', () => {
  it('uses the first real headline, adding the section count past one', () => {
    const s1 = section({ total_rounds: 12, total_extra_reps: 4 });
    expect(resultLine([s1], 0)).toMatch(/12 rounds/);
    expect(resultLine([s1, section()], 0)).toMatch(/· 2 sections$/);
  });

  it('falls back to honest counts, never a fake result', () => {
    expect(resultLine([section()], 0)).toBe('1 section');
    expect(resultLine([], 3)).toBe('3 results');
    expect(resultLine([], 0)).toBe('No results recorded');
  });

  it('uses free text for notes-only formats', () => {
    const s = section({ section_format: 'no_score', free_text_result: 'Felt strong' });
    expect(resultLine([s], 0)).toBe('Felt strong');
  });
});
