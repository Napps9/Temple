// What the gym took, and what it is about to lose.
//
// The first `ask` about the gym rather than about one person, and the
// shape the rest of step 4 follows: no new data, no new queries — the
// numbers already exist behind the Money screen, and the work is saying
// them in one sentence instead of three tiles.
//
// It reads three things because an owner asking "how did last month go"
// means all three: what came in from memberships, what came in from the
// shop, and what is currently failing. A revenue figure with a broken
// direct debit sitting behind it is a half-answer.
//
// Deliberately per-currency. Both summary RPCs group by currency and a gym
// that has taken payment in two will get two rows; adding them up would
// produce a number that is not money in any currency at all.

import { formatMoney } from '../coach-earnings';

import {
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type SummaryRow = { currency: string; gross_cents: number };
type MembershipRow = SummaryRow & { charge_count: number };
type StoreRow = SummaryRow & { order_count: number };

type Period = { from: string; to: string };

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "1 to 31 July", "in the last 30 days" — the period read back the way it
// was asked for, so the number is never floating free of what it counts.
export function periodLabel(p: Period, defaulted: boolean): string {
  if (defaulted) return 'in the last 30 days';
  const from = new Date(`${p.from}T12:00:00`);
  const to = new Date(`${p.to}T12:00:00`);
  const sameMonth =
    from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const day = (d: Date) => d.getDate();
  const month = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (p.from === p.to) return `on ${day(from)} ${month(from)}`;
  return sameMonth
    ? `${day(from)} to ${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} to ${day(to)} ${month(to)}`;
}

// One line per currency, so two currencies read as two facts rather than
// one wrong sum.
function tookLine(rows: MembershipRow[]): string {
  const real = rows.filter((r) => (r.gross_cents ?? 0) > 0);
  if (real.length === 0) return 'Nothing came in from memberships.';
  return real
    .map((r) => {
      const n = r.charge_count ?? 0;
      return (
        `${formatMoney(r.gross_cents, r.currency)} from memberships, ` +
        `across ${n} payment${n === 1 ? '' : 's'}`
      );
    })
    .join('. ');
}

function shopLine(rows: StoreRow[]): string | null {
  const real = rows.filter((r) => (r.gross_cents ?? 0) > 0);
  if (real.length === 0) return null;
  return real
    .map((r) => {
      const n = r.order_count ?? 0;
      return (
        `${formatMoney(r.gross_cents, r.currency)} from the shop, ` +
        `across ${n} order${n === 1 ? '' : 's'}`
      );
    })
    .join('. ');
}

type FailingRow = {
  price_cents: number | null;
  plan_subscription_dunning: { past_due_since: string }[] | null;
};

// What is failing right now, which is not a fact about the period at all —
// it is the thing an owner actually wants to know next, and leaving it out
// makes a good month read better than it is.
async function failingNow(ctx: ActionContext): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('plan_subscriptions')
    .select('price_cents, plan_subscription_dunning!inner(past_due_since)')
    .eq('gym_id', ctx.gymId)
    .eq('status', 'active');
  if (error) return null;
  const rows = (data ?? []) as unknown as FailingRow[];
  if (rows.length === 0) return null;
  const atRisk = rows.reduce((sum, r) => sum + (r.price_cents ?? 0), 0);
  const n = rows.length;
  return atRisk > 0
    ? `${n} membership${n === 1 ? '' : 's'} failing right now — ${formatMoney(atRisk, 'GBP')} a month at risk.`
    : `${n} membership${n === 1 ? '' : 's'} failing right now.`;
}

type Args = { from: string; to: string; defaulted: boolean };

export const moneySummary: ActionSpec<Args> = {
  name: 'money.summary',
  kind: 'ask',
  capability: 'can_see_money',
  says:
    'What the gym took — "what did we take last month", "how much came in ' +
    'last week", "how did July go", "what are we making".',
  args: [
    {
      name: 'from',
      type: 'date',
      desc:
        'First day of the period, YYYY-MM-DD. "last month" is the whole of ' +
        'the previous calendar month; "this month" starts on the 1st. Omit ' +
        'both dates if they named no period.',
    },
    {
      name: 'to',
      type: 'date',
      desc: 'Last day of the period, YYYY-MM-DD, inclusive.',
    },
  ],
  sanitise: (raw) => {
    const from = argString(raw, 'from', 10);
    const to = argString(raw, 'to', 10);
    // Both or neither: half a period is not a period, and silently pairing
    // a stated start with today invents an answer to a different question.
    if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && to >= from) {
      return { from, to, defaulted: false };
    }
    return { from: localDay(-30), to: localDay(), defaulted: true };
  },
  preview: async (a, ctx) => {
    const [memberships, store, failing] = await Promise.all([
      ctx.supabase.rpc('compute_revenue_summary', {
        p_gym_id: ctx.gymId,
        p_period_start: a.from,
        p_period_end: a.to,
      }),
      ctx.supabase.rpc('store_revenue_summary', {
        p_gym_id: ctx.gymId,
        p_period_start: a.from,
        p_period_end: a.to,
      }),
      failingNow(ctx),
    ]);
    // can_see_money gates the RPC itself, so a refusal here is the server
    // disagreeing with the catalogue rather than an empty month.
    if (memberships.error) {
      return { title: 'You do not have permission to see the money.', lines: [] };
    }
    const when = periodLabel({ from: a.from, to: a.to }, a.defaulted);
    const mRows = (memberships.data ?? []) as MembershipRow[];
    const sRows = (store.data ?? []) as StoreRow[];
    const shop = shopLine(sRows);
    const nothing =
      mRows.every((r) => (r.gross_cents ?? 0) === 0) && shop === null;

    return {
      title: nothing
        ? `Nothing came in ${when}.`
        : `${tookLine(mRows)} ${when}.`,
      lines: [...(shop ? [`${shop}.`] : []), ...(failing ? [failing] : [])],
    };
  },
};

export const MONEY_ACTIONS: AnyAction[] = [erase(moneySummary)];
