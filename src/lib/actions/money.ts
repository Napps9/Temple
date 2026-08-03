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

import { weighRows, type ActionAnswer } from '../answer';
import { formatMoney } from '../coach-earnings';
import { computeRefund, type PlanKind, type RefundMode } from '../refunds';
import { formatPrice } from '../setup-flow';

import { dayLabel, matchPlan, readTarget, resolveTarget } from './members';
import {
  ActionError,
  argBool,
  argEnum,
  argMoney,
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
  // plan_subscriptions carries no currency of its own — the gym's is the
  // one these are billed in, and hard-coding GBP here would have put a
  // pound sign on a euro gym's at-risk figure while every other line on
  // this card read its currency off the summary rows.
  const [subs, gym] = await Promise.all([
    ctx.supabase
      .from('plan_subscriptions')
      .select('price_cents, plan_subscription_dunning!inner(past_due_since)')
      .eq('gym_id', ctx.gymId)
      .eq('status', 'active'),
    ctx.supabase.from('gyms').select('currency').eq('id', ctx.gymId).maybeSingle(),
  ]);
  if (subs.error) return null;
  const rows = (subs.data ?? []) as unknown as FailingRow[];
  if (rows.length === 0) return null;
  const currency = (gym.data as { currency: string } | null)?.currency ?? 'GBP';
  const atRisk = rows.reduce((sum, r) => sum + (r.price_cents ?? 0), 0);
  const n = rows.length;
  return atRisk > 0
    ? `${n} membership${n === 1 ? '' : 's'} failing right now — ${formatMoney(atRisk, currency)} a month at risk.`
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
      answer: nothing ? undefined : moneyAnswer(mRows, sRows, when),
    };
  },
};

// The totals as a figure and a split, when there is one currency to show
// them in. Two currencies get the prose only: a single headline number
// would have to add them up, and £900 + €400 is not £1,300 of anything.
// No series — these RPCs return period totals, not a run of days, and
// drawing a trend from one number is the chart that lies.
function moneyAnswer(
  mRows: MembershipRow[],
  sRows: StoreRow[],
  when: string,
): ActionAnswer | undefined {
  const currencies = new Set(
    [...mRows, ...sRows].filter((r) => (r.gross_cents ?? 0) > 0).map((r) => r.currency),
  );
  if (currencies.size !== 1) return undefined;
  const currency = [...currencies][0];
  const memberships = mRows.reduce((n, r) => n + (r.gross_cents ?? 0), 0);
  const shopCents = sRows.reduce((n, r) => n + (r.gross_cents ?? 0), 0);
  const rows = [
    { name: 'Memberships', detail: formatMoney(memberships, currency), value: memberships },
    { name: 'The shop', detail: formatMoney(shopCents, currency), value: shopCents },
  ].filter((r) => r.value > 0);

  return {
    figure: {
      value: formatMoney(memberships + shopCents, currency),
      label: `taken ${when}`,
    },
    list: rows.length > 1 ? { label: 'Where from', rows: weighRows(rows) } : undefined,
  };
}

// ============================================================================
// money.set_plan_price
// ============================================================================
//
// The price on a plan is the one number in the gym that three systems have
// an opinion about: the plans screen, the website, and the Stripe Price
// object minted at the first checkout. Until 0215 the third one never
// heard about a change, so an owner could put Unlimited up to £60 and keep
// selling it at £50 with no surface disagreeing. The trigger fixes that;
// this card's job is to say the other half out loud — the people already
// on the plan keep what they signed up at, and that is deliberate, not an
// omission.

type PriceChange = { plan: string; cents: number };

// A pack is bought once, a credit period renews, only an unlimited plan is
// "a month". The same phrasing members.ts uses, because a price that reads
// differently in two places reads as two prices.
function per(kind: string): string {
  if (kind === 'credit_pack') return ' one off';
  if (kind === 'credit_period') return ' a period';
  return ' a month';
}

async function countOnPlan(planId: string, ctx: ActionContext): Promise<number> {
  const { count } = await ctx.supabase
    .from('plan_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', ctx.gymId)
    .eq('plan_id', planId)
    .in('status', ['active', 'cancelled_at_period_end', 'refunded_retained']);
  return count ?? 0;
}

export const setPlanPrice: ActionSpec<PriceChange> = {
  name: 'money.set_plan_price',
  kind: 'do',
  capability: 'can_manage_plans',
  says:
    'Change what a membership plan costs — "put Unlimited up to £60", ' +
    '"drop off-peak to £35", "make the ten-class pack £90". Not for shop ' +
    'items, which is store.set_price.',
  args: [
    { name: 'plan', type: 'string', desc: 'The plan, as the owner named it', required: true },
    {
      name: 'price',
      type: 'money',
      desc: "The new price, in whole currency as they said it — not minor units",
      required: true,
    },
  ],
  invalidate: [
    'membership-plans',
    'membership-plans-active',
    'membership-plan-names',
    'gym-plans',
    'website-editor-plans',
    'website-preview-plans',
  ],
  sanitise: (raw) => {
    const plan = argString(raw, 'plan', 80);
    const cents = argMoney(raw, 'price');
    return plan && cents !== null ? { plan, cents } : null;
  },
  preview: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind === 'none') {
      return { title: `You don't have a plan called “${a.plan}”.`, lines: [] };
    }
    if (found.kind === 'many') {
      return {
        title: `“${a.plan}” could be more than one of your plans — which?`,
        lines: [],
        choices: found.names.map((n) => ({ label: n, args: { plan: n, price: a.cents / 100 } })),
      };
    }
    const plan = found.plan;
    if (plan.monthly_price_cents === a.cents) {
      return {
        title: `${plan.name} is already ${formatPrice(a.cents, ctx.currency)}.`,
        lines: [],
      };
    }
    const on = await countOnPlan(plan.plan_id, ctx);
    const was = plan.monthly_price_cents;
    return {
      title: `Change what ${plan.name} costs?`,
      lines: [
        `${was === null ? 'no price set' : formatPrice(was, ctx.currency)} → ${formatPrice(a.cents, ctx.currency)}${per(plan.kind)}`,
        on === 0
          ? 'Nobody is on it, so this only affects who signs up next.'
          : `${on} member${on === 1 ? '' : 's'} on it keep paying ${formatPrice(was, ctx.currency)} — a price change is never backdated.`,
        'Anyone signing up from now pays the new price.',
      ],
      yes: 'Yes, change it',
    };
  },
  apply: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
    const { error } = await ctx.supabase
      .from('membership_plans')
      .update({ monthly_price_cents: a.cents })
      .eq('gym_id', ctx.gymId)
      .eq('plan_id', found.plan.plan_id);
    if (error) {
      throw new ActionError(
        /row-level security|permission/i.test(error.message)
          ? 'You do not have permission to change plan prices.'
          : "That didn't save — try again.",
      );
    }
    return `${found.plan.name} is now ${formatPrice(a.cents, ctx.currency)}${per(found.plan.kind)} for new sign-ups.`;
  },
};

// ============================================================================
// money.refund
// ============================================================================
//
// The only action in the registry that moves money out of the gym's
// account, and the one place a chip is not a convenience. "Refund Marcus"
// is four different refunds — the unused part, the whole thing with access
// ending now, the whole thing with access running out, or the money back
// with the membership untouched — and they differ by tens of pounds and by
// whether the member can train tomorrow. So the mode is never guessed: it
// is not in the vocabulary the parser sees, and the card asks with the real
// arithmetic already on each option.
//
// The maths is lib/refunds.ts, the same module the refund dialog previews
// with and the same the edge function mirrors server-side. Nothing here is
// trusted for the amount: stripe-refund recomputes from its own read.

type Refund = {
  member: string;
  mode: RefundMode | null;
  amountCents: number | null;
  notify: boolean;
  profileId: string | null;
  pendingId: string | null;
};

type RefundableSub = {
  id: string;
  status: string;
  credit_balance: number | null;
  paid_period_end: string | null;
  membership_plans: { name: string; kind: string; credit_count: number | null } | null;
};

const REFUNDED_ALREADY = ['cancelled', 'refunded_retained'];

async function latestSub(
  profileId: string,
  ctx: ActionContext,
): Promise<RefundableSub | null> {
  const { data } = await ctx.supabase
    .from('plan_subscriptions')
    .select(
      'id, status, credit_balance, paid_period_end, membership_plans(name, kind, credit_count)',
    )
    .eq('gym_id', ctx.gymId)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data ?? []) as unknown as RefundableSub[])[0] ?? null;
}

export const refundMember: ActionSpec<Refund> = {
  name: 'money.refund',
  kind: 'do',
  capability: 'can_refund',
  says:
    'Give a member their money back — "refund Marcus", "refund Sarah\'s ' +
    'last payment", "give Dan £20 back". Only about a membership payment; ' +
    'a shop order is store.refund_order. NOT for ending or cancelling ' +
    'a membership — no action does that, and a sentence asking for it is ' +
    'none of these.',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    {
      name: 'amount',
      type: 'money',
      desc:
        'Only if they named a sum to give back rather than "refund them". ' +
        'Omit otherwise — the card works out what each kind of refund comes to.',
    },
    {
      name: 'notify',
      type: 'boolean',
      desc: 'False only if they said not to tell the member. They are emailed by default.',
    },
  ],
  invalidate: [
    'member-detail-subs',
    'member-detail-refunds',
    'my-subscriptions',
    'members-cohort',
    'member-detail-cohort',
    'members-subs',
  ],
  // `mode` is not advertised on purpose — see the note above. The chips
  // send it, and they are the only thing that can.
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    if (!member) return null;
    return {
      member,
      mode: argEnum(raw, 'mode', [
        'prorata_revoke',
        'full_period_end',
        'full_revoke',
        'keep',
      ] as const),
      amountCents: argMoney(raw, 'amount'),
      notify: argBool(raw, 'notify') !== false,
      ...readTarget(raw),
    };
  },
  preview: async (a, ctx) => {
    const carry = {
      ...(a.amountCents !== null ? { amount: a.amountCents / 100 } : {}),
      ...(a.notify ? {} : { notify: false }),
    };
    const target = await resolveTarget(a.member, a, carry, ctx);
    if (target.kind === 'unresolved') return target.preview;
    if (target.kind === 'pending') {
      return {
        title: `${target.name} has not claimed their account yet, so there is no payment of theirs to refund.`,
        lines: [],
      };
    }

    const sub = await latestSub(target.profileId, ctx);
    if (!sub) {
      return { title: `${target.name} has never been on a paid membership.`, lines: [] };
    }
    if (REFUNDED_ALREADY.includes(sub.status)) {
      return {
        title: `${target.name}'s ${sub.membership_plans?.name ?? 'membership'} has already been refunded or cancelled.`,
        lines: [],
      };
    }

    // billing_events SELECT is gated on can_see_money (0020) while refunds
    // have their own capability, so a coach who may refund but may not see
    // revenue reads nothing here. That is a different sentence from "they
    // never paid", and saying the wrong one sends the owner looking in the
    // wrong place.
    const { data: charge, error } = await ctx.supabase
      .from('billing_events')
      .select('amount_cents, currency, occurred_at')
      .eq('plan_subscription_id', sub.id)
      .in('kind', ['checkout', 'invoice'])
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return {
        title: 'I cannot see the payments on this account, so I cannot work out a refund.',
        lines: [],
      };
    }
    const paid =
      (charge as { amount_cents: number; currency: string | null; occurred_at: string } | null) ??
      null;
    if (!paid) {
      return {
        title: `No settled payment on ${target.name}'s ${sub.membership_plans?.name ?? 'membership'}, so there is nothing to give back.`,
        lines: [],
      };
    }

    // The currency the charge was taken in, not the platform's. Every
     // figure on this card is a slice of that one payment.
    const cur = (paid.currency ?? 'GBP').toUpperCase();
    const now = new Date().toISOString();
    const ent = {
      planKind: (sub.membership_plans?.kind ?? 'unlimited') as PlanKind,
      chargeCents: paid.amount_cents,
      periodStart: paid.occurred_at,
      periodEnd: sub.paid_period_end,
      creditsTotal: sub.membership_plans?.credit_count ?? null,
      creditsRemaining: sub.credit_balance,
    };
    const amountFor = (m: RefundMode) =>
      computeRefund(ent, m, now, m === 'keep' ? a.amountCents : null).refundCents;

    if (a.mode === null) {
      const chip = (mode: RefundMode, label: string) => ({
        label,
        args: { ...carry, member: target.name, profile_id: target.profileId, mode },
      });
      const prorata = amountFor('prorata_revoke');
      return {
        title: `${target.name} last paid ${formatMoney(paid.amount_cents, cur)} for ${sub.membership_plans?.name ?? 'their membership'}. What kind of refund?`,
        lines: [],
        choices: [
          // A pro-rata of nothing is not a refund — it is ending someone's
          // membership under a heading that says otherwise. Dropped rather
          // than offered at £0.
          ...(prorata > 0
            ? [chip('prorata_revoke', `${formatMoney(prorata, cur)} — the unused part, access ends now`)]
            : []),
          chip(
            'full_period_end',
            `${formatMoney(amountFor('full_period_end'), cur)} — all of it, access runs${sub.paid_period_end ? ` to ${dayLabel(sub.paid_period_end)}` : ' to the period end'}`,
          ),
          chip('full_revoke', `${formatMoney(amountFor('full_revoke'), cur)} — all of it, access ends now`),
          chip(
            'keep',
            `${formatMoney(amountFor('keep'), cur)} — goodwill, membership carries on`,
          ),
        ],
      };
    }

    const cents = amountFor(a.mode);
    const access =
      a.mode === 'keep'
        ? 'Their membership and renewals carry on exactly as they are.'
        : a.mode === 'full_period_end'
          ? `They keep training${sub.paid_period_end ? ` until ${dayLabel(sub.paid_period_end)}` : ' to the end of the period they paid for'}, then it ends. Renewals stop.`
          : 'Access ends the moment this goes through, and renewals stop.';
    return {
      title: `Refund ${target.name} ${formatMoney(cents, cur)}?`,
      lines: [
        `Back to the card they paid with, out of ${formatMoney(paid.amount_cents, cur)} taken on ${dayLabel(paid.occurred_at)}.`,
        access,
        a.notify
          ? 'They get an email saying they have been refunded and what happens to their access.'
          : 'They are not told — no email goes out.',
        // A refund is a billing_events row with kind='refund', which
        // is_revenue_event (0019) excludes. The money summary will not fall
        // by this amount, and an owner who expects it to will think the
        // refund failed.
        'It does not come off your revenue figures — refunds are recorded separately.',
      ],
      yes: `Yes, refund ${formatMoney(cents, cur)}`,
    };
  },
  apply: async (a, ctx) => {
    if (a.mode === null) throw new ActionError('Pick what kind of refund first.');
    const target = await resolveTarget(a.member, a, {}, ctx);
    if (target.kind !== 'member') throw new ActionError("I couldn't find them.");
    const sub = await latestSub(target.profileId, ctx);
    if (!sub) throw new ActionError('There is no membership payment to refund.');

    const { data, error } = await ctx.supabase.functions.invoke('stripe-refund', {
      body: {
        plan_subscription_id: sub.id,
        mode: a.mode,
        custom_cents: a.mode === 'keep' ? a.amountCents : null,
        notify_member: a.notify,
      },
    });
    if (error) throw new ActionError(await refundFailure(error));
    const r = (data ?? {}) as {
      refund_cents: number;
      currency?: string;
      access: string;
    };
    const kept =
      r.access === 'unchanged'
        ? ' Their membership carries on.'
        : r.access === 'until_period_end'
          ? ' They keep access to the end of the period they paid for.'
          : ' Their access has ended.';
    return `${formatMoney(r.refund_cents, r.currency ?? 'GBP')} refunded to ${target.name}.${kept}`;
  },
};

// The edge function answers in sentences an owner can act on — "this gym
// has not connected Stripe yet" — but supabase-js flattens a non-2xx into
// "Edge Function returned a non-2xx status code" and hides the body on
// `context`. Dig it out, exactly as the refund dialog does.
async function refundFailure(e: unknown): Promise<string> {
  const ctx = (e as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through to the generic line
    }
  }
  return 'The refund did not go through. Nothing has been taken from your account.';
}

export const MONEY_ACTIONS: AnyAction[] = [
  erase(moneySummary),
  erase(setPlanPrice),
  erase(refundMember),
];
