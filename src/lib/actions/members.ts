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

import { argString, erase, type ActionContext, type ActionSpec, type AnyAction } from './types';

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
      .eq('profile_id', row.profile_id),
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

export const MEMBER_ACTIONS: AnyAction[] = [erase(findMember)];
