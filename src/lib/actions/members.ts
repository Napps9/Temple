// A member, in the chat.
//
// The first `ask` that isn't prose. "Show me Marcus" wants a face, a
// standing, what they're on and what has gone wrong — so the preview
// names a card and hands it the facts, and the feed renders it. And
// "Webb" resolving to three people is neither an answer nor a failure:
// the preview comes back with `choices`, one chip per person, each
// re-running this same action with the ambiguity already settled.
//
// Every fact past the name is best-effort on purpose. A staff member
// whose capabilities don't stretch to money or tags gets a card without
// them rather than an error where the answer should be — RLS decides what
// lands, exactly as it does on the members screen.

import {
  matchMembers,
  memberStatus,
  sanitiseMemberQuery,
  type MemberStatus,
} from '../chat-lookup';
import { formatPrice } from '../setup-flow';

import {
  ActionError,
  argInt,
  argString,
  erase,
  type ActionContext,
  type ActionPreview,
  type ActionSpec,
  type AnyAction,
} from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COHORT_SELECT =
  'profile_id, joined_at, is_intro, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles!profile_id(full_name)';

type CohortRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null } | null;
};

export type MemberCard = {
  profileId: string;
  name: string;
  joinedAt: string;
  status: MemberStatus;
  planName: string | null;
  priceCents: number | null;
  creditBalance: number | null;
  compCredits: number | null;
  pastDueSince: string | null;
  tags: { label: string; color: string; source: 'manual' | 'auto' }[];
};

type SubRow = {
  status: string;
  credit_balance: number | null;
  price_cents: number | null;
  membership_plans: { name: string } | null;
};

async function buildCard(
  row: CohortRow & { name: string },
  ctx: ActionContext,
): Promise<MemberCard> {
  const [subs, comps, tags, dun] = await Promise.all([
    ctx.supabase
      .from('plan_subscriptions')
      .select('status, credit_balance, price_cents, membership_plans(name)')
      .eq('gym_id', ctx.gymId)
      .eq('profile_id', row.profile_id)
      .order('created_at', { ascending: false })
      .limit(1),
    ctx.supabase
      .from('comp_grants')
      .select('credits_remaining')
      .eq('gym_id', ctx.gymId)
      .eq('profile_id', row.profile_id)
      // Live only, the same three filters the members list uses. Without
      // them a revoked or long-expired grant reads back as comped classes
      // the member does not have.
      .is('revoked_at', null)
      .lte('starts_at', new Date().toISOString())
      .gte('ends_at', new Date().toISOString()),
    ctx.supabase
      .from('member_tags')
      .select('label, color, source')
      .eq('gym_id', ctx.gymId)
      .eq('profile_id', row.profile_id),
    ctx.supabase
      .from('plan_subscription_dunning')
      .select('past_due_since')
      .eq('gym_id', ctx.gymId)
      .eq('profile_id', row.profile_id)
      .maybeSingle(),
  ]);
  const sub = ((subs.data ?? []) as unknown as SubRow[])[0] ?? null;
  const compCredits = ((comps.data ?? []) as { credits_remaining: number | null }[]).reduce(
    (sum, c) => sum + (c.credits_remaining ?? 0),
    0,
  );
  return {
    profileId: row.profile_id,
    name: row.name,
    joinedAt: row.joined_at,
    status: memberStatus({
      isIntro: row.is_intro,
      isActive: row.is_active,
      isExpiringSoon: row.is_expiring_soon,
      isExpired: row.is_expired,
      daysUntilExpiry: row.days_until_expiry,
    }),
    planName: sub?.membership_plans?.name ?? null,
    priceCents: sub?.price_cents ?? null,
    creditBalance: sub?.credit_balance ?? null,
    compCredits: compCredits > 0 ? compCredits : null,
    pastDueSince:
      (dun.data as { past_due_since: string | null } | null)?.past_due_since ?? null,
    tags: (tags.data ?? []) as MemberCard['tags'],
  };
}

export const findMember: ActionSpec<{ query: string | null; profileId: string | null }> = {
  name: 'members.find',
  kind: 'ask',
  capability: 'can_access_staff_area',
  says:
    'Bring one member up — "show me Marcus", "what\'s Sarah Jones on", "is ' +
    'Dan still paying". Use this whenever the sentence is a question about ' +
    'one person rather than an instruction.',
  args: [
    {
      name: 'query',
      type: 'string',
      desc: 'Their name, exactly as the owner said it',
      required: true,
    },
  ],
  // `profile_id` is deliberately not in `args`: nobody types a uuid, so
  // the parser is never told about it. It exists because the pick-list
  // chips send it, and those go straight to sanitise without the model.
  sanitise: (raw) => {
    const profileId = argString(raw, 'profile_id', 64);
    const query = sanitiseMemberQuery(raw.query);
    if (profileId && UUID_RE.test(profileId)) return { profileId, query };
    return query ? { query, profileId: null } : null;
  },
  preview: async (a, ctx) => {
    if (a.profileId) {
      const { data, error } = await ctx.supabase
        .from('v_member_cohort')
        .select(COHORT_SELECT)
        .eq('gym_id', ctx.gymId)
        .eq('profile_id', a.profileId)
        .single();
      if (error || !data) {
        return { title: "I couldn't pull that one up.", lines: [] };
      }
      const row = data as unknown as CohortRow;
      const name = row.profiles?.full_name?.trim() || a.query || 'This member';
      return {
        title: name,
        lines: [],
        card: 'member',
        data: await buildCard({ ...row, name }, ctx),
      };
    }

    const query = a.query!;
    const { data, error } = await ctx.supabase
      .from('v_member_cohort')
      .select(COHORT_SELECT)
      .eq('gym_id', ctx.gymId);
    if (error) throw error;
    const named = ((data ?? []) as unknown as CohortRow[])
      .filter((r) => r.profiles?.full_name?.trim())
      .map((r) => ({ ...r, name: r.profiles!.full_name!.trim() }));
    const hits = matchMembers(named, query);
    if (hits.length === 0) {
      return { title: `No one called “${query}” on your books.`, lines: [] };
    }
    if (hits.length > 1) {
      return {
        title: `A few people could be “${query}” — which one did you mean?`,
        lines: [],
        choices: hits.map((h) => ({
          label: h.name,
          args: { profile_id: h.profile_id, query: h.name },
        })),
      };
    }
    return {
      title: hits[0].name,
      lines: [],
      card: 'member',
      data: await buildCard(hits[0], ctx),
    };
  },
};

// ============================================================================
// Resolving who was meant
// ============================================================================
//
// Shared by every member action, because "Marcus" is ambiguous in two
// different ways and both have to be handled the same wherever they come
// up. He might be one of three Marcuses — that is a question, answered
// with chips. Or he might not have claimed his account yet, in which case
// he is on the import list rather than the roster, and the work lands
// somewhere else entirely.

type Target =
  | { kind: 'member'; profileId: string; name: string }
  | { kind: 'pending'; pendingId: string; name: string; billedByCard: boolean }
  | { kind: 'unresolved'; preview: ActionPreview };

type PendingRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  imported_stripe_subscription_id: string | null;
};

const PENDING_SELECT =
  'id, email, full_name, status, imported_stripe_subscription_id';

// `carry` is the rest of the sentence — the plan, the number of days, the
// message. A chip has to re-run the whole action, not just the name.
async function resolveTarget(
  query: string,
  ids: { profileId: string | null; pendingId: string | null },
  carry: Record<string, unknown>,
  ctx: ActionContext,
): Promise<Target> {
  if (ids.profileId) {
    const { data } = await ctx.supabase
      .from('profiles')
      .select('full_name')
      .eq('id', ids.profileId)
      .maybeSingle();
    const name = (data as { full_name: string | null } | null)?.full_name?.trim();
    return { kind: 'member', profileId: ids.profileId, name: name || query };
  }
  if (ids.pendingId) {
    const { data } = await ctx.supabase
      .from('pending_members')
      .select(PENDING_SELECT)
      .eq('gym_id', ctx.gymId)
      .eq('id', ids.pendingId)
      .maybeSingle();
    const row = data as PendingRow | null;
    if (!row) return { kind: 'unresolved', preview: { title: "I couldn't find them.", lines: [] } };
    return {
      kind: 'pending',
      pendingId: row.id,
      name: row.full_name?.trim() || row.email,
      billedByCard: !!row.imported_stripe_subscription_id,
    };
  }

  const { data: cohort } = await ctx.supabase
    .from('v_member_cohort')
    .select('profile_id, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId);
  const joined = ((cohort ?? []) as unknown as {
    profile_id: string;
    profiles: { full_name: string | null } | null;
  }[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({ id: r.profile_id, name: r.profiles!.full_name!.trim() }));
  const hits = matchMembers(joined, query);
  if (hits.length === 1) {
    return { kind: 'member', profileId: hits[0].id, name: hits[0].name };
  }
  if (hits.length > 1) {
    return {
      kind: 'unresolved',
      preview: {
        title: `A few people could be “${query}” — which one did you mean?`,
        lines: [],
        choices: hits.map((h) => ({
          label: h.name,
          args: { ...carry, member: h.name, profile_id: h.id },
        })),
      },
    };
  }

  // Nobody on the roster answers to it. They may be on the import list
  // and simply not here yet, which is a different job with the same
  // sentence.
  const { data: pending } = await ctx.supabase
    .from('pending_members')
    .select(PENDING_SELECT)
    .eq('gym_id', ctx.gymId)
    .neq('status', 'linked');
  const waiting = ((pending ?? []) as PendingRow[]).map((r) => ({
    id: r.id,
    name: r.full_name?.trim() || r.email,
    billedByCard: !!r.imported_stripe_subscription_id,
  }));
  const pendingHits = matchMembers(waiting, query);
  if (pendingHits.length === 1) {
    return {
      kind: 'pending',
      pendingId: pendingHits[0].id,
      name: pendingHits[0].name,
      billedByCard: pendingHits[0].billedByCard,
    };
  }
  if (pendingHits.length > 1) {
    return {
      kind: 'unresolved',
      preview: {
        title: `A few people on your import list could be “${query}” — which one?`,
        lines: [],
        choices: pendingHits.map((h) => ({
          label: h.name,
          args: { ...carry, member: h.name, pending_id: h.id },
        })),
      },
    };
  }
  return {
    kind: 'unresolved',
    preview: { title: `No one called “${query}” on your books.`, lines: [] },
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Local, not UTC: an owner in Auckland saying "until today" must not have it
// read as yesterday and dropped.
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readTarget(raw: Record<string, unknown>) {
  const profileId = argString(raw, 'profile_id', 64);
  const pendingId = argString(raw, 'pending_id', 64);
  return {
    profileId: profileId && UUID_RE.test(profileId) ? profileId : null,
    pendingId: pendingId && UUID_RE.test(pendingId) ? pendingId : null,
  };
}

// Takes a bare YYYY-MM-DD or the date half of an ISO timestamp, and reads
// the parts rather than handing the string to Date: `new Date('2026-08-30')`
// is UTC midnight, which renders as the 29th for anyone west of Greenwich.
function dayLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  ).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// ============================================================================
// members.assign_plan
// ============================================================================

type PlanRow = {
  plan_id: string;
  name: string;
  kind: 'unlimited' | 'credit_period' | 'credit_pack' | 'programming_only';
  credit_count: number | null;
  monthly_price_cents: number | null;
};

type PlanMatch =
  | { kind: 'one'; plan: PlanRow }
  | { kind: 'none' }
  | { kind: 'many'; names: string[] };

// Deliberately not store.ts's matchProduct: when two plans both answer to
// what the owner said, the right move is to name them rather than refuse
// silently, because the owner can only fix it if they know what the
// choices were.
async function matchPlan(query: string, ctx: ActionContext): Promise<PlanMatch> {
  const { data } = await ctx.supabase
    .from('membership_plans')
    .select('plan_id, name, kind, credit_count, monthly_price_cents')
    .eq('gym_id', ctx.gymId)
    .is('archived_at', null);
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

type SubRowLite = {
  id: string;
  plan_id: string;
  price_cents: number | null;
  stripe_subscription_id: string | null;
  membership_plans: { name: string } | null;
};

// What they are on now, by the same statuses the door uses.
async function currentMembership(
  profileId: string,
  ctx: ActionContext,
): Promise<SubRowLite | null> {
  const { data } = await ctx.supabase
    .from('plan_subscriptions')
    .select('id, plan_id, price_cents, stripe_subscription_id, membership_plans(name)')
    .eq('gym_id', ctx.gymId)
    .eq('profile_id', profileId)
    .in('status', ['active', 'cancelled_at_period_end', 'refunded_retained'])
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data ?? []) as unknown as SubRowLite[])[0] ?? null;
}

// A pack is bought once and a credit period renews; only an unlimited plan
// is "a month". Getting this wrong puts a price on the card that no other
// screen in the app agrees with.
function pricePhrase(kind: string, cents: number | null): string {
  if (cents === null || cents === 0) return 'free';
  const money = formatPrice(cents);
  if (kind === 'credit_pack') return `${money} one off`;
  if (kind === 'credit_period') return `${money} a period`;
  return `${money} a month`;
}

function priceLine(plan: PlanRow): string {
  const price = pricePhrase(plan.kind, plan.monthly_price_cents);
  return plan.kind === 'credit_pack'
    ? `${plan.name} — ${plan.credit_count} classes, ${price}, not billed`
    : `${plan.name} — ${price}, not billed`;
}

type Assign = {
  member: string;
  plan: string;
  until: string | null;
  profileId: string | null;
  pendingId: string | null;
  mode: 'move' | 'add' | null;
};

export const assignPlan: ActionSpec<Assign> = {
  name: 'members.assign_plan',
  kind: 'do',
  capability: 'can_assign_plan',
  says:
    'Put one member on a membership plan — "put Marcus on Unlimited", ' +
    '"move Sarah to off-peak", "give Dan the ten-class pack until the end ' +
    'of March". Not for creating a plan, which is gym.add_plans.',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    { name: 'plan', type: 'string', desc: 'The plan, as the owner named it', required: true },
    {
      name: 'until',
      type: 'date',
      desc:
        'YYYY-MM-DD, only if they said how long ("until the end of March"). ' +
        'Omit otherwise — the plan\'s own period is the default.',
    },
  ],
  invalidate: [
    'members-cohort',
    'member-detail-cohort',
    'members-subs',
    'member-detail-subs',
    'member-detail-membership',
    'members-pending',
  ],
  // profile_id, pending_id and mode are not advertised: nobody types a
  // uuid, and "move him or add it as well" is a question the card asks
  // rather than something a sentence answers. The chips send them.
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    const plan = argString(raw, 'plan', 80);
    if (!member || !plan) return null;
    const until = argString(raw, 'until', 10);
    const mode = argString(raw, 'mode', 8);
    const today = localToday();
    return {
      member,
      plan,
      until: until && ISO_DATE.test(until) && until >= today ? until : null,
      mode: mode === 'move' || mode === 'add' ? mode : null,
      ...readTarget(raw),
    };
  },
  preview: async (a, ctx) => {
    const carry = { plan: a.plan, ...(a.until ? { until: a.until } : {}) };
    const [found, target] = await Promise.all([
      matchPlan(a.plan, ctx),
      resolveTarget(a.member, a, carry, ctx),
    ]);
    if (found.kind === 'none') {
      return { title: `You don't have a plan called “${a.plan}”.`, lines: [] };
    }
    if (found.kind === 'many') {
      return {
        title: `“${a.plan}” could be more than one of your plans — which?`,
        lines: [],
        choices: found.names.map((n) => ({
          label: n,
          args: { member: a.member, plan: n, ...(a.until ? { until: a.until } : {}) },
        })),
      };
    }
    if (target.kind === 'unresolved') return target.preview;
    const plan = found.plan;
    // A programming-only plan is not a class entitlement, and putting someone
    // on one would stop them booking classes altogether (see 0211's header).
    // Refuse here so the card never offers what the RPC will reject.
    if (plan.kind === 'programming_only') {
      return {
        title: `${plan.name} doesn't cover class booking, so putting someone on it from here would stop them booking classes at all.`,
        lines: [],
      };
    }
    const runs = a.until
      ? `Runs until ${dayLabel(a.until)}, then stops.`
      : plan.kind === 'credit_pack'
        ? 'No end date — the credits are the limit.'
        : 'A month from today, then it stops. Say "until X" for a different stretch.';

    if (target.kind === 'pending') {
      // An adopt-mode import carries a live Stripe subscription, which the
      // claim trigger copies onto whatever plan is earmarked — so they would
      // keep paying the old price under a new name, and "nothing to pay"
      // would be false.
      if (target.billedByCard) {
        return {
          title: `${target.name} came across with a live card payment, so changing their plan is a billing change I can't make from here yet.`,
          lines: [],
        };
      }
      return {
        title: `Earmark ${plan.name} for ${target.name}?`,
        lines: [
          priceLine(plan),
          `It lands the moment they claim their account — nothing to pay, and no signing up again.`,
          runs,
        ],
        yes: 'Yes, earmark it',
      };
    }

    const now = await currentMembership(target.profileId, ctx);
    // Refused whichever was asked for, and before the two chips are offered:
    // moving them would bill the old price forever, and adding a newer
    // unbilled membership beside it would take over the one recurring
    // subscription their own screen resolves, so they could no longer cancel
    // or switch the thing they are actually paying for.
    if (now?.stripe_subscription_id) {
      return {
        title: `${target.name} pays ${now.membership_plans?.name ?? 'their membership'} by card, so changing it is a billing change I can't make from here yet.`,
        lines: [],
      };
    }
    if (now && a.mode === null) {
      const on = now.membership_plans?.name ?? 'a membership';
      const price = now.price_cents !== null ? `, ${formatPrice(now.price_cents)} a month` : '';
      return {
        title: `${target.name} is on ${on}${price}.`,
        lines: [],
        choices: [
          {
            label: `Move them to ${plan.name}`,
            args: { ...carry, member: target.name, profile_id: target.profileId, mode: 'move' },
          },
          {
            label: `Add ${plan.name} as well`,
            args: { ...carry, member: target.name, profile_id: target.profileId, mode: 'add' },
          },
        ],
      };
    }
    const moving = now && a.mode === 'move';
    return {
      title: moving
        ? `Move ${target.name} from ${now!.membership_plans?.name ?? 'their membership'} to ${plan.name}?`
        : `Put ${target.name} on ${plan.name}?`,
      lines: [
        priceLine(plan),
        moving
          ? 'The same membership changes plan — nothing restarts and their history stays in one piece.'
          : 'They can book from now.',
        runs,
        ...(plan.kind === 'credit_period'
          ? ['Credits will not top up on their own while it is unbilled.']
          : []),
      ],
      yes: moving ? 'Yes, move them' : 'Yes, put them on it',
    };
  },
  apply: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
    const target = await resolveTarget(a.member, a, {}, ctx);

    if (target.kind === 'pending') {
      const { data, error } = await ctx.supabase.rpc('earmark_pending_member_plan', {
        p_gym_id: ctx.gymId,
        p_pending_id: target.pendingId,
        p_plan_id: found.plan.plan_id,
        p_until: a.until,
      });
      if (error) throw new ActionError(receiptFor(error.message));
      const r = (data ?? {}) as { runs_to: string | null };
      return (
        `${found.plan.name} is earmarked for ${target.name}. It lands the ` +
        `moment they claim their account — nothing to pay and no signing up ` +
        `again.${r.runs_to ? ` Runs to ${dayLabel(r.runs_to)}.` : ''}`
      );
    }
    if (target.kind !== 'member') throw new ActionError("I couldn't find them.");

    const { data, error } = await ctx.supabase.rpc('assign_member_plan', {
      p_gym_id: ctx.gymId,
      p_profile_id: target.profileId,
      p_plan_id: found.plan.plan_id,
      p_until: a.until,
      p_mode: a.mode ?? 'move',
    });
    if (error) throw new ActionError(receiptFor(error.message));
    const r = (data ?? {}) as {
      switched: boolean;
      plan_name: string;
      plan_kind: string;
      price_cents: number | null;
      runs_to: string | null;
    };
    const price =
      r.price_cents !== null && r.price_cents > 0
        ? `${pricePhrase(r.plan_kind, r.price_cents)}, not billed`
        : 'no charge';
    const until = r.runs_to ? ` Runs to ${dayLabel(r.runs_to)}.` : '';
    return r.switched
      ? `${target.name} is on ${r.plan_name} — ${price}. Same membership, nothing restarted.${until}`
      : `${target.name} is on ${r.plan_name} — ${price}. They can book from now.${until}`;
  },
};

// The RPCs raise in words on purpose; these are the ones an owner can act
// on, so they reach the feed as written rather than as "that didn't save".
function receiptFor(message: string): string {
  if (/billed by card/i.test(message)) {
    return 'They pay by card, so moving them is a billing change I cannot make from here yet.';
  }
  if (/Already joined/i.test(message)) {
    return 'They have already claimed their account, so there is nothing to earmark — put them on the plan directly.';
  }
  if (/does not cover classes/i.test(message)) {
    return "That plan doesn't cover class booking, so it can't be assigned from here.";
  }
  if (/End date out of range/i.test(message)) {
    return 'That end date is either in the past or more than a year out.';
  }
  if (/Not a member/i.test(message)) return 'They are not a member of this gym.';
  if (/No such plan/i.test(message)) return 'That plan is no longer there.';
  if (/Not authorised/i.test(message)) return 'You do not have permission to do that.';
  return "That didn't save — try again.";
}

// ============================================================================
// members.comp
// ============================================================================

type Comp = {
  member: string;
  days: number | null;
  credits: number | null;
  reason: string | null;
  profileId: string | null;
  pendingId: string | null;
};

export const compMember: ActionSpec<Comp> = {
  name: 'members.comp',
  kind: 'do',
  capability: 'can_issue_comp_grant',
  says:
    'Give one member classes on the house — "comp Sarah for a month", ' +
    '"give Dan 5 free classes", "put Jo on us for two weeks while she\'s injured".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    {
      name: 'days',
      type: 'integer',
      desc: 'How long the comp runs, in days. 30 if they said "a month" or did not say.',
      min: 1,
      max: 366,
    },
    {
      name: 'credits',
      type: 'integer',
      desc:
        'A specific number of free classes, if they named one. Omit for ' +
        'unlimited access inside the window.',
      min: 1,
      max: 500,
    },
    { name: 'reason', type: 'string', desc: 'Why, if they said' },
  ],
  invalidate: [
    'members-cohort',
    'member-detail-cohort',
    'members-comps',
    'member-detail-comps',
  ],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    if (!member) return null;
    return {
      member,
      days: argInt(raw, 'days', 1, 366),
      credits: argInt(raw, 'credits', 1, 500),
      reason: argString(raw, 'reason', 120),
      ...readTarget(raw),
    };
  },
  preview: async (a, ctx) => {
    const carry = {
      ...(a.days !== null ? { days: a.days } : {}),
      ...(a.credits !== null ? { credits: a.credits } : {}),
      ...(a.reason ? { reason: a.reason } : {}),
    };
    const target = await resolveTarget(a.member, a, carry, ctx);
    if (target.kind === 'unresolved') return target.preview;
    if (target.kind === 'pending') {
      return {
        title: `${target.name} has not claimed their account yet, so there is nothing to comp.`,
        lines: [],
      };
    }
    const days = a.days ?? 30;
    const ends = new Date(Date.now() + days * 86_400_000).toISOString();
    return {
      title: `Comp ${target.name}${days === 30 ? ' for a month' : ` for ${days} days`}?`,
      lines: [
        a.credits !== null
          ? `${a.credits} classes on the house, no charge.`
          : 'Every class, no charge, for as long as it runs.',
        `Runs to ${dayLabel(ends)}.`,
        // is_intro is has_live_comp and not is_paying (0049), so a comp
        // relabels them on the roster. Better said now than discovered.
        'While it runs they read as "On an intro" on your roster.',
        ...(a.reason ? [`Reason: ${a.reason}`] : []),
      ],
      yes: 'Yes, comp them',
    };
  },
  apply: async (a, ctx) => {
    const target = await resolveTarget(a.member, a, {}, ctx);
    if (target.kind !== 'member') throw new ActionError("I couldn't find them.");
    const { data, error } = await ctx.supabase.rpc('grant_member_comp', {
      p_gym_id: ctx.gymId,
      p_profile_id: target.profileId,
      p_days: a.days ?? 30,
      p_credits: a.credits,
      p_reason: a.reason,
    });
    if (error) throw new ActionError(receiptFor(error.message));
    const r = (data ?? {}) as { days: number; credits: number | null; ends_at: string };
    return r.credits !== null
      ? `${target.name} has ${r.credits} classes on the house, to ${dayLabel(r.ends_at)}.`
      : `${target.name} is on us to ${dayLabel(r.ends_at)}. Every class, no charge.`;
  },
};

// ============================================================================
// members.tag
// ============================================================================

type Tag = {
  member: string;
  label: string;
  memberVisible: boolean;
  profileId: string | null;
  pendingId: string | null;
};

export const tagMember: ActionSpec<Tag> = {
  name: 'members.tag',
  kind: 'do',
  capability: 'can_manage_tags',
  says:
    'Put a label on one member — "tag Jo as injured", "mark Marcus as a ' +
    'competitor", "tag Sarah nightshift".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    { name: 'label', type: 'string', desc: 'The tag itself, short — one or two words', required: true },
    {
      name: 'visible',
      type: 'boolean',
      desc: 'True only if they said the member should see it. Tags are staff-only by default.',
    },
  ],
  invalidate: ['member-tags', 'member-tags-for', 'member-detail-tags', 'members-cohort'],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    const label = argString(raw, 'label', 40);
    if (!member || !label) return null;
    return {
      member,
      label,
      memberVisible: raw.visible === true,
      ...readTarget(raw),
    };
  },
  preview: async (a, ctx) => {
    const target = await resolveTarget(
      a.member,
      a,
      { label: a.label, ...(a.memberVisible ? { visible: true } : {}) },
      ctx,
    );
    if (target.kind === 'unresolved') return target.preview;
    if (target.kind === 'pending') {
      return {
        title: `${target.name} has not claimed their account yet, so there is nothing to tag.`,
        lines: [],
      };
    }
    return {
      title: `Tag ${target.name} as “${a.label}”?`,
      lines: [
        a.memberVisible
          ? 'They will see this tag on their own account.'
          : 'Staff only — the member never sees it.',
        // The nightly rule sweep and the member_tagged automation both
        // read tags, so a tag is not always a private note.
        'Tag rules and any automation watching this tag pick it up on the next sweep.',
      ],
      yes: 'Yes, tag them',
    };
  },
  apply: async (a, ctx) => {
    const target = await resolveTarget(a.member, a, {}, ctx);
    if (target.kind !== 'member') throw new ActionError("I couldn't find them.");
    // The unique index is (gym_id, profile_id, label) — case-SENSITIVE
    // (0013:226), and 0047 exists because someone used lower(label) as an
    // ON CONFLICT arbiter and turned the whole suite red. Check first.
    const { data: existing } = await ctx.supabase
      .from('member_tags')
      .select('id, label')
      .eq('gym_id', ctx.gymId)
      .eq('profile_id', target.profileId)
      .ilike('label', a.label);
    if (((existing ?? []) as { id: string }[]).length > 0) {
      return `${target.name} already has that tag.`;
    }
    const { error } = await ctx.supabase.from('member_tags').insert({
      gym_id: ctx.gymId,
      profile_id: target.profileId,
      label: a.label,
      color: '#6B7280',
      source: 'manual',
      created_by: ctx.userId,
      member_visible: a.memberVisible,
    });
    if (error) throw new ActionError(receiptFor(error.message));
    return `${target.name} is tagged “${a.label}”.`;
  },
};

// ============================================================================
// members.message
// ============================================================================

type Message = {
  member: string;
  body: string;
  profileId: string | null;
  pendingId: string | null;
};

export const messageMember: ActionSpec<Message> = {
  name: 'members.message',
  kind: 'do',
  capability: 'can_access_staff_area',
  says:
    'Send one member a direct message — "message Marcus that his 6am is ' +
    'moved", "tell Sarah we got her injury note".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    {
      name: 'body',
      type: 'string',
      desc:
        'The message, in the owner\'s own words. Do not embellish it or add ' +
        'facts they did not state.',
      required: true,
    },
  ],
  invalidate: ['dm-inbox', 'dm-thread', 'inbox-unread-summary'],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    const body = argString(raw, 'body', 1000);
    if (!member || !body) return null;
    return { member, body, ...readTarget(raw) };
  },
  preview: async (a, ctx) => {
    const target = await resolveTarget(a.member, a, { body: a.body }, ctx);
    if (target.kind === 'unresolved') return target.preview;
    if (target.kind === 'pending') {
      return {
        title: `${target.name} has not claimed their account yet, so there is nowhere to message them.`,
        lines: [],
      };
    }
    return {
      title: `Send this to ${target.name}?`,
      lines: [`“${a.body}”`],
      yes: 'Yes, send it',
    };
  },
  apply: async (a, ctx) => {
    const target = await resolveTarget(a.member, a, {}, ctx);
    if (target.kind !== 'member') throw new ActionError("I couldn't find them.");
    const { error } = await ctx.supabase.from('direct_messages').insert({
      gym_id: ctx.gymId,
      sender_id: ctx.userId,
      recipient_id: target.profileId,
      body: a.body,
    });
    if (error) throw new ActionError(receiptFor(error.message));
    return `Sent to ${target.name}.`;
  },
};

export const MEMBER_ACTIONS: AnyAction[] = [
  erase(findMember),
  erase(assignPlan),
  erase(compMember),
  erase(tagMember),
  erase(messageMember),
];

