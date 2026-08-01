import { describe, expect, it, vi } from 'vitest';

import { retireClassType, restoreClassType } from './classes';
import { reopenGym, setGymColour } from './gym';
import type { ActionContext } from './types';

// The four verbs the settings sections were still the only way to reach.
// Each one is tested for the sentence it has to get right, not for the
// write — the write is one RPC and the card is the whole product.

type TypeRow = { id: string; name: string; archived_at: string | null };
type ClosureRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

const YOGA: TypeRow = { id: 't1', name: 'Yoga', archived_at: null };
const METCON: TypeRow = { id: 't2', name: 'Metcon', archived_at: '2026-01-01T00:00:00Z' };

function typeCtx(opts: {
  types?: TypeRow[];
  upcoming?: number;
  rpc?: (name: string, args: unknown) => { error: { message: string } | null };
  offer?: (label: string, href: string) => void;
}): ActionContext {
  const types = opts.types ?? [YOGA, METCON];
  return {
    supabase: {
      from: (table: string) => ({
        select: () =>
          table === 'class_types'
            ? {
                eq: () => ({
                  is: () =>
                    Promise.resolve({
                      data: types.filter((t) => !t.archived_at),
                      error: null,
                    }),
                  not: () =>
                    Promise.resolve({
                      data: types.filter((t) => !!t.archived_at),
                      error: null,
                    }),
                }),
              }
            : {
                eq: () => ({
                  eq: () => ({
                    gt: () =>
                      Promise.resolve({ count: opts.upcoming ?? 0, error: null }),
                  }),
                }),
              },
      }),
      rpc: async (name: string, args: unknown) =>
        opts.rpc ? opts.rpc(name, args) : { error: null },
    },
    gymId: 'g1',
    userId: 'u1',
    currency: 'GBP',
    offer: opts.offer,
  } as unknown as ActionContext;
}

describe('classes.retire_type', () => {
  it('says the history survives, because "archive" does not read that way', async () => {
    const p = await retireClassType.preview({ classType: 'Yoga' }, typeCtx({ upcoming: 4 }));
    expect(p.title).toBe('Stop running Yoga?');
    expect(p.lines[2]).toContain('attendance history is untouched');
  });

  it('warns that what is already scheduled still runs', async () => {
    const many = await retireClassType.preview({ classType: 'Yoga' }, typeCtx({ upcoming: 4 }));
    expect(many.lines[1]).toContain('The 4 already on the timetable still run');
    expect(many.lines[1]).toContain('cancel them separately');

    const one = await retireClassType.preview({ classType: 'Yoga' }, typeCtx({ upcoming: 1 }));
    expect(one.lines[1]).toContain('The 1 already on the timetable still runs');
    expect(one.lines[1]).toContain('cancel it separately');

    const none = await retireClassType.preview({ classType: 'Yoga' }, typeCtx({ upcoming: 0 }));
    expect(none.lines[1]).toBe('Nothing of it is on the timetable ahead.');
  });

  it('says a retired class is already retired, not that it does not exist', async () => {
    const p = await retireClassType.preview({ classType: 'Metcon' }, typeCtx({}));
    expect(p.title).toBe('Metcon is already retired.');
    expect(p.yes).toBeUndefined();
  });

  it('archives through the RPC', async () => {
    const rpc = vi.fn(() => ({ error: null }));
    const out = await retireClassType.apply!({ classType: 'Yoga' }, typeCtx({ rpc }));
    expect(rpc).toHaveBeenCalledWith('archive_class_type', { p_id: 't1' });
    expect(out).toContain('Yoga is retired');
  });
});

describe('classes.restore_type', () => {
  it('says the gap stays empty, which "bring it back" does not imply', async () => {
    const p = await restoreClassType.preview({ classType: 'Metcon' }, typeCtx({}));
    expect(p.title).toBe('Start running Metcon again?');
    expect(p.lines[1]).toContain('the weeks it was off stay empty');
  });

  it('only ever looks at retired classes', async () => {
    const live = await restoreClassType.preview({ classType: 'Yoga' }, typeCtx({}));
    expect(live.title).toBe('Yoga is already running.');
  });
});

// ---------------------------------------------------------------------------

function brandCtx(opts: {
  branding?: Record<string, unknown> | null;
  rpc?: (name: string, args: unknown) => { error: { message: string } | null };
}): ActionContext {
  const branding =
    opts.branding === undefined
      ? {
          logo_url: null,
          primary_color: '#2563EB',
          secondary_color: '#111827',
          text_color: '#FFFFFF',
          logo_url_dark: null,
          primary_color_dark: null,
          secondary_color_dark: null,
          text_color_dark: null,
        }
      : opts.branding;
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: branding, error: null }) }),
        }),
      }),
      rpc: async (name: string, args: unknown) =>
        opts.rpc ? opts.rpc(name, args) : { error: null },
    },
    gymId: 'g1',
    userId: 'u1',
    currency: 'GBP',
  } as unknown as ActionContext;
}

describe('gym.set_colour', () => {
  it('takes a hex and refuses anything that is not one', () => {
    expect(setGymColour.sanitise({ colour: '#e11d48' })).toEqual({ colour: '#E11D48' });
    // The parser is asked to convert a colour name itself; a word arriving
    // here means it could not, and guessing a hex from it would pick a
    // colour nobody chose.
    expect(setGymColour.sanitise({ colour: 'navy' })).toBeNull();
    expect(setGymColour.sanitise({ colour: '#E11D4' })).toBeNull();
    expect(setGymColour.sanitise({ colour: 'E11D48' })).toBeNull();
  });

  it('says dark mode follows when nobody has hand-picked one', async () => {
    const p = await setGymColour.preview({ colour: '#E11D48' }, brandCtx({}));
    expect(p.title).toBe('Change your brand colour to #E11D48?');
    expect(p.lines[0]).toContain('#2563EB → #E11D48');
    expect(p.lines[1]).toBe('Dark mode follows it automatically.');
  });

  it('says a hand-picked dark colour is kept, rather than silently keeping it', async () => {
    const p = await setGymColour.preview(
      { colour: '#E11D48' },
      brandCtx({
        branding: {
          logo_url: null,
          primary_color: '#2563EB',
          secondary_color: '#111827',
          text_color: '#FFFFFF',
          logo_url_dark: null,
          primary_color_dark: '#60A5FA',
          secondary_color_dark: null,
          text_color_dark: null,
        },
      }),
    );
    expect(p.lines[1]).toContain('stays as it is');
  });

  it('does not ask to change a colour that is already set', async () => {
    const p = await setGymColour.preview({ colour: '#2563EB' }, brandCtx({}));
    expect(p.title).toBe('Your brand colour is already #2563EB.');
    expect(p.yes).toBeUndefined();
  });

  // Every other field goes back exactly as it came, so changing the colour
  // cannot wipe a logo somebody uploaded.
  it('sends the gym its own values for everything it is not changing', async () => {
    const rpc = vi.fn(() => ({ error: null }));
    await setGymColour.apply!({ colour: '#E11D48' }, brandCtx({ rpc }));
    expect(rpc).toHaveBeenCalledWith('set_gym_branding', {
      p_gym_id: 'g1',
      p_logo_url: null,
      p_primary_color: '#E11D48',
      p_secondary_color: '#111827',
      p_text_color: '#FFFFFF',
      p_logo_url_dark: null,
      p_primary_color_dark: null,
      p_secondary_color_dark: null,
      p_text_color_dark: null,
    });
  });
});

// ---------------------------------------------------------------------------

function closureCtx(opts: {
  closures?: ClosureRow[];
  rpc?: (name: string, args: unknown) => { data?: unknown; error: unknown };
  offer?: (label: string, href: string) => void;
}): ActionContext {
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () =>
                Promise.resolve({ data: opts.closures ?? [], error: null }),
            }),
          }),
        }),
      }),
      rpc: async (name: string, args: unknown) =>
        opts.rpc ? opts.rpc(name, args) : { data: { restored: 3 }, error: null },
    },
    gymId: 'g1',
    userId: 'u1',
    currency: 'GBP',
    offer: opts.offer,
  } as unknown as ActionContext;
}

const XMAS: ClosureRow = {
  id: 'c1',
  starts_on: '2026-12-24',
  ends_on: '2026-12-28',
  reason: 'Christmas',
};

describe('gym.reopen', () => {
  it('says so when nothing is closed', async () => {
    const p = await reopenGym.preview({ on: null }, closureCtx({ closures: [] }));
    expect(p.title).toBe('The gym is not closed for anything at the moment.');
  });

  it('says the bookings do not come back, which "undo" would imply', async () => {
    const p = await reopenGym.preview({ on: null }, closureCtx({ closures: [XMAS] }));
    expect(p.title).toBe('Open the gym back up for 24 December to 28 December?');
    expect(p.lines[1]).toContain('bookings are not restored');
  });

  it('asks which when two closures are open at once', async () => {
    const other: ClosureRow = {
      id: 'c2',
      starts_on: '2027-01-02',
      ends_on: '2027-01-02',
      reason: 'Burst pipe',
    };
    const p = await reopenGym.preview({ on: null }, closureCtx({ closures: [XMAS, other] }));
    expect(p.title).toBe('Which closure is ending?');
    expect(p.choices?.map((c) => c.label)).toEqual([
      '24 December to 28 December — Christmas',
      '2 January — Burst pipe',
    ]);
  });

  it('picks the closure a named date falls inside', async () => {
    const p = await reopenGym.preview({ on: '2026-12-26' }, closureCtx({ closures: [XMAS] }));
    expect(p.title).toContain('24 December to 28 December');
    expect(p.yes).toBe('Yes, open it back up');
  });

  it('says nothing is closed on a date outside every closure', async () => {
    const p = await reopenGym.preview({ on: '2026-11-01' }, closureCtx({ closures: [XMAS] }));
    expect(p.title).toBe('Nothing is closed on 1 November.');
    expect(p.lines[0]).toBe('Closed 24 December to 28 December — Christmas.');
  });

  it('reports how many classes went back on', async () => {
    const rpc = vi.fn(() => ({ data: { restored: 12 }, error: null }));
    const out = await reopenGym.apply!({ on: null }, closureCtx({ closures: [XMAS], rpc }));
    expect(rpc).toHaveBeenCalledWith('reopen_closure', {
      p_closure_id: 'c1',
      p_exclude: [],
    });
    expect(out).toContain('12 classes are back on');
  });

  it('does not claim classes came back when none did', async () => {
    const rpc = () => ({ data: { restored: 0 }, error: null });
    const out = await reopenGym.apply!({ on: null }, closureCtx({ closures: [XMAS], rpc }));
    expect(out).toContain('nothing left to put back');
  });
});
