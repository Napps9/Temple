// Taking a membership off the shelf, and putting it back.
//
// The plans editor is 1,100 lines and the only two verbs an owner reaches
// for between one price change and the next are these: a plan they have
// stopped selling, and occasionally one they want back. Everything else
// on that screen — the seven-column form, the archived drawer, the hard
// delete behind its own capability — is authoring, and authoring keeps
// its screen.
//
// Archiving is deliberately not "deleting a plan that has members". The
// people on it keep their subscription, their price and their access;
// what changes is that it stops being offered — the join page, the
// website's plan block and the staff assign-plan picker all filter
// `archived_at is null`. Saying that on the card is the whole job,
// because "archive" reads like "cancel these people" to anyone who has
// not read the schema.
//
// The retire/restore RPCs asked user_is_owner_of until 0245 while their
// buttons were gated on can_archive_plans, so an admin who had been
// granted the capability was offered these verbs and refused by the
// database. That is fixed, and it is why these two can honestly
// advertise the capability the Team screen sells.

import { formatPrice } from '../setup-flow';

import { matchPlan } from './members';
import {
  ActionError,
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';

type PlanRow = {
  plan_id: string;
  name: string;
  kind: string;
  monthly_price_cents: number | null;
};

type ArchivedMatch =
  | { kind: 'one'; plan: PlanRow }
  | { kind: 'many'; names: string[] }
  | { kind: 'none' };

// matchPlan only ever sees live plans, which is right for every other
// action and useless for this one — restoring is by definition about a
// plan that is not in that list. Same matching rules, opposite filter.
async function matchArchivedPlan(
  query: string,
  ctx: ActionContext,
): Promise<ArchivedMatch> {
  const { data } = await ctx.supabase
    .from('membership_plans')
    .select('plan_id, name, kind, monthly_price_cents')
    .eq('gym_id', ctx.gymId)
    .not('archived_at', 'is', null);
  const rows = (data ?? []) as PlanRow[];
  const q = query.toLowerCase().replace(/^the /, '').trim();
  const exact = rows.find((r) => r.name.toLowerCase() === q);
  if (exact) return { kind: 'one', plan: exact };
  const near = rows.filter(
    (r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()),
  );
  if (near.length === 1) return { kind: 'one', plan: near[0] };
  if (near.length > 1) return { kind: 'many', names: near.map((r) => r.name) };
  return { kind: 'none' };
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

function refusal(message: string): ActionError {
  return new ActionError(
    /not authorised|row-level security|permission/i.test(message)
      ? 'You do not have permission to retire plans.'
      : "That didn't save — try again.",
  );
}

// ============================================================================
// plans.retire
// ============================================================================

type PlanTarget = { plan: string };

export const retirePlan: ActionSpec<PlanTarget> = {
  name: 'plans.retire',
  kind: 'do',
  capability: 'can_archive_plans',
  says:
    'Stop selling a membership plan — "stop selling the off-peak ' +
    'membership", "retire the student plan", "take the 10-class pack off ' +
    'sale", "archive Unlimited". Not for shop products, and never for ' +
    'ending one person\'s membership.',
  args: [
    { name: 'plan', type: 'string', desc: 'The plan, as the owner named it', required: true },
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
    return plan ? { plan } : null;
  },
  preview: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind === 'none') {
      // The plan they named may already be off sale, in which case the
      // honest answer is "that is already done" and not "no such plan".
      const gone = await matchArchivedPlan(a.plan, ctx);
      return {
        title:
          gone.kind === 'one'
            ? `${gone.plan.name} is already off sale.`
            : `You don't have a plan called “${a.plan}”.`,
        lines: [],
      };
    }
    if (found.kind === 'many') {
      return {
        title: `“${a.plan}” could be more than one of your plans — which?`,
        lines: [],
        choices: found.names.map((n) => ({ label: n, args: { plan: n } })),
      };
    }
    const plan = found.plan;
    const on = await countOnPlan(plan.plan_id, ctx);
    return {
      title: `Stop selling ${plan.name}?`,
      lines: [
        on === 0
          ? 'Nobody is on it.'
          : `The ${on} ${on === 1 ? 'member' : 'members'} on it keep it — their membership, their price and their access are untouched.`,
        'It comes off your join page, your website and the plan picker, so nobody new can pick it.',
        'Reversible: say "bring back ' + plan.name + '" whenever you want it back.',
      ],
      yes: 'Yes, stop selling it',
    };
  },
  apply: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
    const { error } = await ctx.supabase.rpc('archive_plan', {
      p_plan_id: found.plan.plan_id,
    });
    if (error) throw refusal(error.message);
    ctx.offer?.('Open plans', '/management/plans');
    return `${found.plan.name} is off sale. Anyone already on it keeps it.`;
  },
};

// ============================================================================
// plans.restore
// ============================================================================

export const restorePlan: ActionSpec<PlanTarget> = {
  name: 'plans.restore',
  kind: 'do',
  capability: 'can_archive_plans',
  says:
    'Put a retired membership plan back on sale — "bring back the ' +
    'off-peak membership", "start selling the student plan again", ' +
    '"unarchive the 10-class pack".',
  args: [
    { name: 'plan', type: 'string', desc: 'The plan, as the owner named it', required: true },
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
    return plan ? { plan } : null;
  },
  preview: async (a, ctx) => {
    const found = await matchArchivedPlan(a.plan, ctx);
    if (found.kind === 'none') {
      const live = await matchPlan(a.plan, ctx);
      return {
        title:
          live.kind === 'one'
            ? `${live.plan.name} is already on sale.`
            : `You have no retired plan called “${a.plan}”.`,
        lines: [],
      };
    }
    if (found.kind === 'many') {
      return {
        title: `“${a.plan}” could be more than one of your retired plans — which?`,
        lines: [],
        choices: found.names.map((n) => ({ label: n, args: { plan: n } })),
      };
    }
    const plan = found.plan;
    return {
      title: `Put ${plan.name} back on sale?`,
      lines: [
        // At whatever it was when it was retired — restore_plan clears
        // archived_at and touches nothing else, so an owner expecting to
        // be asked for a price would be surprised by silence.
        plan.monthly_price_cents === null
          ? 'It goes back with no price set, exactly as you left it.'
          : `It goes back at ${formatPrice(plan.monthly_price_cents, ctx.currency)}, exactly as you left it.`,
        'It reappears on your join page, your website and the plan picker.',
      ],
      yes: 'Yes, put it back',
    };
  },
  apply: async (a, ctx) => {
    const found = await matchArchivedPlan(a.plan, ctx);
    if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
    const { error } = await ctx.supabase.rpc('restore_plan', {
      p_plan_id: found.plan.plan_id,
    });
    if (error) throw refusal(error.message);
    ctx.offer?.('Open plans', '/management/plans');
    return `${found.plan.name} is back on sale.`;
  },
};

export const PLAN_ACTIONS: AnyAction[] = [erase(retirePlan), erase(restorePlan)];
