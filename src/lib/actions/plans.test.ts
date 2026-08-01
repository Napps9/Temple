import { describe, expect, it, vi } from 'vitest';

import { retirePlan, restorePlan } from './plans';
import type { ActionContext } from './types';

type Row = {
  plan_id: string;
  name: string;
  kind: string;
  monthly_price_cents: number | null;
  archived_at: string | null;
};

const UNLIMITED: Row = {
  plan_id: 'p1',
  name: 'Unlimited',
  kind: 'unlimited',
  monthly_price_cents: 8900,
  archived_at: null,
};
const OFF_PEAK: Row = {
  plan_id: 'p2',
  name: 'Off-peak',
  kind: 'unlimited',
  monthly_price_cents: 5900,
  archived_at: '2026-01-01T00:00:00Z',
};

function ctxFor(opts: {
  plans?: Row[];
  on?: number;
  rpc?: (name: string, args: unknown) => { error: { message: string } | null };
  offer?: (label: string, href: string) => void;
}): ActionContext {
  const plans = opts.plans ?? [UNLIMITED, OFF_PEAK];
  // One thenable that carries the rows it has been narrowed to, so the
  // `.is()` and `.not()` filters read as the actions wrote them.
  const planQuery = (rows: Row[]) => ({
    eq: () => ({
      is: () => Promise.resolve({ data: rows.filter((r) => !r.archived_at), error: null }),
      not: () => Promise.resolve({ data: rows.filter((r) => !!r.archived_at), error: null }),
    }),
  });
  const subQuery = () => ({
    eq: () => ({
      eq: () => ({ in: () => Promise.resolve({ count: opts.on ?? 0, error: null }) }),
    }),
  });
  return {
    supabase: {
      from: (table: string) => ({
        select: () => (table === 'membership_plans' ? planQuery(plans) : subQuery()),
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

describe('plans.retire', () => {
  it('says the people on it keep it, because "archive" does not read that way', async () => {
    const p = await retirePlan.preview({ plan: 'Unlimited' }, ctxFor({ on: 12 }));
    expect(p.title).toBe('Stop selling Unlimited?');
    expect(p.lines[0]).toContain('12 members on it keep it');
    expect(p.lines[1]).toContain('nobody new can pick it');
  });

  it('says nobody is on it rather than "0 members keep it"', async () => {
    const p = await retirePlan.preview({ plan: 'Unlimited' }, ctxFor({ on: 0 }));
    expect(p.lines[0]).toBe('Nobody is on it.');
  });

  it('tells an owner a retired plan is already off sale, not that it does not exist', async () => {
    const p = await retirePlan.preview({ plan: 'Off-peak' }, ctxFor({}));
    expect(p.title).toBe('Off-peak is already off sale.');
    expect(p.yes).toBeUndefined();
  });

  it('does not invent a plan that was never there', async () => {
    const p = await retirePlan.preview({ plan: 'Platinum' }, ctxFor({}));
    expect(p.title).toBe('You don\'t have a plan called “Platinum”.');
  });

  it('asks which when the name matches more than one live plan', async () => {
    const plans: Row[] = [
      { ...UNLIMITED, plan_id: 'a', name: 'Student monthly' },
      { ...UNLIMITED, plan_id: 'b', name: 'Student annual' },
    ];
    const p = await retirePlan.preview({ plan: 'Student' }, ctxFor({ plans }));
    expect(p.choices?.map((c) => c.label)).toEqual(['Student monthly', 'Student annual']);
  });

  it('archives through the RPC, not a direct write', async () => {
    const rpc = vi.fn(() => ({ error: null }));
    const out = await retirePlan.apply!({ plan: 'Unlimited' }, ctxFor({ rpc }));
    expect(rpc).toHaveBeenCalledWith('archive_plan', { p_plan_id: 'p1' });
    expect(out).toBe('Unlimited is off sale. Anyone already on it keeps it.');
  });

  it('turns a refusal into the permission it was, not "try again"', async () => {
    const rpc = () => ({ error: { message: 'Not authorised' } });
    await expect(retirePlan.apply!({ plan: 'Unlimited' }, ctxFor({ rpc }))).rejects.toThrow(
      'You do not have permission to retire plans.',
    );
  });
});

describe('plans.restore', () => {
  it('names the price it comes back at, since restoring asks for nothing', async () => {
    const p = await restorePlan.preview({ plan: 'Off-peak' }, ctxFor({}));
    expect(p.title).toBe('Put Off-peak back on sale?');
    expect(p.lines[0]).toContain('£59');
    expect(p.lines[0]).toContain('exactly as you left it');
  });

  it('handles a plan retired before it ever had a price', async () => {
    const plans = [{ ...OFF_PEAK, monthly_price_cents: null }];
    const p = await restorePlan.preview({ plan: 'Off-peak' }, ctxFor({ plans }));
    expect(p.lines[0]).toBe('It goes back with no price set, exactly as you left it.');
  });

  it('tells an owner a live plan is already on sale', async () => {
    const p = await restorePlan.preview({ plan: 'Unlimited' }, ctxFor({}));
    expect(p.title).toBe('Unlimited is already on sale.');
    expect(p.yes).toBeUndefined();
  });

  it('only ever looks at retired plans', async () => {
    const p = await restorePlan.preview({ plan: 'Platinum' }, ctxFor({}));
    expect(p.title).toBe('You have no retired plan called “Platinum”.');
  });

  it('restores through the RPC and offers the screen', async () => {
    const rpc = vi.fn(() => ({ error: null }));
    const offer = vi.fn();
    const out = await restorePlan.apply!({ plan: 'Off-peak' }, ctxFor({ rpc, offer }));
    expect(rpc).toHaveBeenCalledWith('restore_plan', { p_plan_id: 'p2' });
    expect(offer).toHaveBeenCalledWith('Open plans', '/management/plans');
    expect(out).toBe('Off-peak is back on sale.');
  });
});

describe('both', () => {
  it('sanitise refuses an empty plan name rather than matching everything', () => {
    expect(retirePlan.sanitise({ plan: '  ' })).toBeNull();
    expect(restorePlan.sanitise({})).toBeNull();
  });
});
