import { describe, expect, it, vi } from 'vitest';

import { clearDay, copyWeek } from './programming';
import type { ProgrammingChangeCard } from '../programming-copy';

// Today is Wednesday 5 August 2026 in the gym's zone, so this week's
// Monday is the 3rd. Every offset below is read against that.
const NOW = Date.UTC(2026, 7, 5, 9, 0);

type Row = { class_type_id: string; date: string; sections: unknown };

function section(title: string, body = '') {
  return {
    section_category: 'wod',
    section_format: 'for_time',
    title,
    body,
    leaderboard_enabled: false,
  };
}

// Enough of PostgREST's builder to serve the two reads these actions do,
// plus a record of the writes so the tests can assert on what would land.
function ctxFor(opts: {
  programming?: Row[];
  classTypes?: { id: string; name: string }[];
  onUpsert?: (rows: unknown[]) => void;
  onDelete?: (filters: Record<string, string>) => void;
}) {
  const programming = opts.programming ?? [];
  const classTypes = opts.classTypes ?? [{ id: 'ct-wod', name: 'Barbell club' }];

  function programmingQuery() {
    const filters: Record<string, string> = {};
    const q: Record<string, unknown> = {
      eq: (col: string, val: string) => {
        filters[col] = val;
        return q;
      },
      gte: (_c: string, v: string) => {
        filters.from = v;
        return q;
      },
      lte: (_c: string, v: string) => {
        filters.to = v;
        return q;
      },
      then: (resolve: (r: { data: Row[]; error: null }) => void) =>
        resolve({
          data: programming.filter(
            (r) => r.date >= (filters.from ?? '') && r.date <= (filters.to ?? '9999'),
          ),
          error: null,
        }),
    };
    return q;
  }

  return {
    supabase: {
      from: (table: string) => ({
        select: () =>
          table === 'class_programming'
            ? programmingQuery()
            : table === 'gyms'
              ? {
                  eq: () => ({
                    single: async () => ({
                      data: { timezone: 'Europe/London' },
                      error: null,
                    }),
                  }),
                }
              : {
                  eq: () => ({
                    is: () => ({
                      order: async () => ({ data: classTypes, error: null }),
                    }),
                  }),
                },
        upsert: async (rows: unknown[]) => {
          opts.onUpsert?.(rows);
          return { error: null };
        },
        delete: () => {
          const filters: Record<string, string> = {};
          const d: Record<string, unknown> = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return d;
            },
            then: (resolve: (r: { error: null }) => void) => {
              opts.onDelete?.(filters);
              resolve({ error: null });
            },
          };
          return d;
        },
      }),
    },
    gymId: 'gym',
    userId: 'coach',
    currency: 'GBP',
    offer: vi.fn(),
  } as never;
}

describe('copying a week, as a sentence', () => {
  it('defaults to last week onto next week', () => {
    expect(copyWeek.sanitise({})).toEqual({ from: -1, to: 1 });
  });

  // The one arrangement that is always a mistake and always looks like a
  // valid request.
  it('refuses to copy a week onto itself', () => {
    expect(copyWeek.sanitise({ from: 0, to: 0 })).toBeNull();
    expect(copyWeek.sanitise({ from: -1, to: -1 })).toBeNull();
  });

  it('takes offsets rather than dates, so nobody has to do calendar arithmetic', () => {
    expect(copyWeek.sanitise({ from: -2, to: 0 })).toEqual({ from: -2, to: 0 });
    expect(copyWeek.sanitise({ from: 'nonsense', to: 3 })).toEqual({ from: -1, to: 3 });
  });
});

describe('the card a copy shows before it is agreed to', () => {
  it('quotes what arrives and what it lands on', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await copyWeek.preview(
      { from: -1, to: 0 },
      ctxFor({
        programming: [
          // Last week: Monday 27 July.
          { class_type_id: 'ct-wod', date: '2026-07-27', sections: [section('Back squat', '5x5')] },
          // This week: Monday 3 August already has something on it.
          {
            class_type_id: 'ct-wod',
            date: '2026-08-03',
            sections: [section('Partner chipper', 'written Sunday night')],
          },
        ],
      }),
    );
    expect(p.card).toBe('programming');
    const card = p.data as ProgrammingChangeCard;
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0].incoming).toEqual(['Back squat — 5x5']);
    expect(card.rows[0].replacing).toEqual(['Partner chipper — written Sunday night']);
    // The confirm label changes when something is lost, so the tap that
    // agrees to an overwrite does not read like the tap that agrees to a
    // copy onto a blank week.
    expect(p.yes).toBe('Yes, replace them');
    vi.restoreAllMocks();
  });

  it('says there is nothing to copy rather than offering an empty confirm', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await copyWeek.preview({ from: -1, to: 1 }, ctxFor({}));
    expect(p.card).toBeUndefined();
    expect(p.yes).toBeUndefined();
    expect(p.title).toBe('There is nothing programmed that week to copy.');
    vi.restoreAllMocks();
  });

  it('writes each session onto the same weekday of the target week', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const written: unknown[] = [];
    const receipt = await copyWeek.apply!(
      { from: -1, to: 1 },
      ctxFor({
        programming: [
          // Wednesday 29 July.
          { class_type_id: 'ct-wod', date: '2026-07-29', sections: [section('Fran')] },
        ],
        onUpsert: (rows) => written.push(...rows),
      }),
    );
    // Next week's Wednesday is 12 August.
    expect((written[0] as { date: string }).date).toBe('2026-08-12');
    expect((written[0] as { author_id: string }).author_id).toBe('coach');
    expect(receipt).toBe('Copied. One session now sits on the week of 10 Aug.');
    vi.restoreAllMocks();
  });
});

describe('clearing a day', () => {
  it('needs to be told which day', () => {
    expect(clearDay.sanitise({})).toBeNull();
    expect(clearDay.sanitise({ day: 'Saturday' })).toEqual({ day: 'Saturday', week: 0 });
    expect(clearDay.sanitise({ day: 'Saturday', week: 1 })).toEqual({
      day: 'Saturday',
      week: 1,
    });
  });

  // weekdayIndex counts from Sunday and the week runs Monday-first, so
  // this mapping is exactly where an off-by-one would silently wipe the
  // wrong day.
  it('resolves a weekday name against the gym’s week', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await clearDay.preview(
      { day: 'Saturday', week: 0 },
      ctxFor({
        programming: [
          { class_type_id: 'ct-wod', date: '2026-08-08', sections: [section('Partner WOD')] },
        ],
      }),
    );
    const card = p.data as ProgrammingChangeCard;
    expect(card.heading).toBe('Saturday 8 Aug');
    expect(card.rows[0].replacing).toEqual(['Partner WOD']);
    expect(p.yes).toBe('Yes, wipe it');
    vi.restoreAllMocks();
  });

  it('puts Sunday at the end of the week, not the start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await clearDay.preview(
      { day: 'Sunday', week: 0 },
      ctxFor({
        programming: [
          { class_type_id: 'ct-wod', date: '2026-08-09', sections: [section('Recovery')] },
        ],
      }),
    );
    expect((p.data as ProgrammingChangeCard).heading).toBe('Sunday 9 Aug');
    vi.restoreAllMocks();
  });

  it('takes a full date and ignores the week offset then', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await clearDay.preview(
      { day: '2026-12-25', week: 4 },
      ctxFor({
        programming: [
          { class_type_id: 'ct-wod', date: '2026-12-25', sections: [section('Festive')] },
        ],
      }),
    );
    expect((p.data as ProgrammingChangeCard).heading).toBe('Friday 25 Dec');
    vi.restoreAllMocks();
  });

  it('refuses a day it cannot resolve rather than guessing one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await clearDay.preview({ day: 'the weekend', week: 0 }, ctxFor({}));
    expect(p.yes).toBeUndefined();
    expect(p.title).toMatch(/could not work out which day/);
    vi.restoreAllMocks();
  });

  it('does not offer to wipe a day with nothing on it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const p = await clearDay.preview({ day: 'Tuesday', week: 0 }, ctxFor({}));
    expect(p.card).toBeUndefined();
    expect(p.title).toBe('There is nothing programmed that day.');
    vi.restoreAllMocks();
  });
});
