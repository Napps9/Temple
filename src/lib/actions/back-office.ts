// Two questions about the platform rather than about the gym: where a
// screen is, and which screens get opened.
//
// The first exists because the bar's failure mode is the wrong one. Ask it
// something it has no verb for and it says it cannot do that — when very
// often there IS a surface, it just is not a sentence yet. The Back Office
// index already knows every one of them by the words people reach for, so
// the bar can answer with a door instead of a refusal.
//
// It offers the door; it does not walk through it. That rule is in
// types.ts and it is why this is an `ask` rather than a third kind of
// action: navigating on the owner's behalf empties the conversation they
// were in the middle of.

import {
  BACK_OFFICE,
  visibleEntries,
  type BackOfficeEntry,
} from '../back-office';
import {
  findScreenAnswer,
  usageAnswer,
  type RouteUsageRow,
} from '../back-office-answers';
import {
  ActionError,
  argInt,
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';

// Which surfaces this particular person may be sent to. Filtering the
// vocabulary is not enough for an action whose answer IS a list of
// screens — without this it would happily tell a coach where Billing is.
// `can` undefined means the capability set has not resolved, which is not
// permission, so the honest fallback is nothing rather than everything.
function reachable(ctx: ActionContext): BackOfficeEntry[] {
  if (!ctx.can) return [];
  return visibleEntries(ctx.can, ctx.role ?? null);
}

type FindScreenArgs = { what: string };

export const findScreen: ActionSpec<FindScreenArgs> = {
  name: 'system.find_screen',
  kind: 'ask',
  // Anyone who can be on a staff screen may ask where one is. Not null:
  // "somebody with no capabilities is offered no verb" is an invariant the
  // registry keeps, and this would have been the first thing to break it.
  // The answer is then filtered again, to the surfaces this particular
  // person can actually reach — the vocabulary gate cannot do that, because
  // the action is allowed and only its results are privileged.
  capability: 'can_access_staff_area',
  says:
    'where a setting or screen lives — "take me to coach earnings", "where ' +
    'do I set the cancel cutoff", "where is the thing that refunds ' +
    'somebody", "how do I change the logo"',
  args: [
    {
      name: 'what',
      type: 'string',
      desc: 'What they are looking for, in their words.',
      required: true,
    },
  ],
  sanitise: (raw) => {
    const what = argString(raw, 'what', 80);
    return what ? { what } : null;
  },
  preview: async (a, ctx) => {
    const entries = reachable(ctx);
    if (entries.length === 0) {
      throw new ActionError('I cannot see what you have access to right now.');
    }
    const answer = findScreenAnswer(a.what, entries);
    if (answer.offer) ctx.offer?.(answer.offer.label, answer.offer.href);
    return {
      title: answer.title,
      lines: answer.lines,
      ...(answer.choices ? { choices: answer.choices } : {}),
    };
  },
};

type UsageArgs = { days: number };

export const screenUsage: ActionSpec<UsageArgs> = {
  name: 'usage.what_nobody_opens',
  kind: 'ask',
  capability: 'can_manage_staff',
  says:
    'which screens actually get opened — "what does nobody open", "which ' +
    'screens do we actually use", "is anyone opening the store page"',
  args: [
    {
      name: 'days',
      type: 'integer',
      desc: 'How far back to look. Defaults to 90, which is as far as it is kept.',
      min: 1,
      max: 90,
    },
  ],
  sanitise: (raw) => ({ days: argInt(raw, 'days', 1, 90) ?? 90 }),
  preview: async (a, ctx) => {
    const { data, error } = await ctx.supabase.rpc('gym_route_usage', {
      p_gym_id: ctx.gymId,
      p_days: a.days,
    });
    if (error) throw new ActionError('I could not read the screen counts.');
    const rows = ((data ?? []) as RouteUsageRow[]).map((r) => ({
      ...r,
      opens: Number(r.opens),
    }));
    // Every surface, not just the ones this person can reach: the question
    // is what the gym uses, and an admin asking it is deciding what to
    // keep rather than looking for somewhere to go.
    return usageAnswer(rows, BACK_OFFICE, a.days);
  },
};

export const BACK_OFFICE_ACTIONS: AnyAction[] = [
  erase(findScreen),
  erase(screenUsage),
];
