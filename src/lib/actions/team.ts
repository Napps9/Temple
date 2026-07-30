// The team, and the labels that sort the members.
//
// Two thin modules together, because both are mostly one job each and
// neither earns a file of its own.
//
// The team's honest state: an owner can bring somebody in by saying so,
// and can ask who is here. They cannot change a role or take somebody
// off, because Temple has no write for either — no RPC, no screen, no
// client update anywhere. Rather than offer a verb that would fail, both
// are named in docs/roadmap.md as needing a write first, exactly like
// coach reassignment.
//
// Tag rules are the other half of `members.tag`: that one labels a
// person, this one describes a kind of person and lets the sweep find
// them. The predicate set is the tag editor's own (0200), minus the two
// that need a class type — those want a second name resolved and are
// better said on the screen than guessed at here.

import { matchPlan } from './members';
import {
  ActionError,
  argEnum,
  argInt,
  argString,
  erase,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';

// ============================================================================
// team.invite
// ============================================================================
//
// Gated on can_manage_staff rather than can_invite, which is the switch
// the invite form on the members screen reads. The two agree by default
// (owner + admin) and create_invite asks for can_manage_staff, so gating
// on can_invite would put a verb in the catalogue that the database then
// refuses — the exact shape of bug this session has been closing. The
// mismatch itself is a decision for the owner, not for me: see
// docs/roadmap.md.

type Invite = { email: string; role: 'admin' | 'coach' | 'staff' | 'member' };

const ROLES = ['admin', 'coach', 'staff', 'member'] as const;

const ROLE_WORDS: Record<Invite['role'], string> = {
  admin: 'an admin',
  coach: 'a coach',
  staff: 'front desk',
  member: 'a member',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const inviteToTeam: ActionSpec<Invite> = {
  name: 'team.invite',
  kind: 'do',
  capability: 'can_manage_staff',
  says:
    'Bring someone onto the team — "invite Sam as a coach, ' +
    'sam@example.com", "add jo@example.com to the front desk", "invite ' +
    'dan@example.com as an admin".',
  args: [
    { name: 'email', type: 'string', desc: 'Their email address', required: true },
    {
      name: 'role',
      type: 'enum',
      values: [...ROLES],
      desc:
        'coach for someone who runs classes, staff for front desk, admin ' +
        'for someone who helps run the place, member for an ordinary ' +
        'member. Coach unless they said otherwise.',
    },
  ],
  invalidate: ['staff-roster', 'gym-member-names'],
  sanitise: (raw) => {
    const email = argString(raw, 'email', 160)?.toLowerCase() ?? null;
    if (!email || !EMAIL_RE.test(email)) return null;
    return { email, role: argEnum(raw, 'role', ROLES) ?? 'coach' };
  },
  preview: async (a, ctx) => {
    // Already here, under any role: an invite would be a second account
    // on the same address and the accept link would collide.
    const { data } = await ctx.supabase
      .from('gym_memberships')
      .select('role, profiles!profile_id(full_name)')
      .eq('gym_id', ctx.gymId)
      .is('left_at', null);
    const names = ((data ?? []) as unknown as {
      role: string;
      profiles: { full_name: string | null } | null;
    }[]).length;
    return {
      title: `Invite ${a.email} as ${ROLE_WORDS[a.role]}?`,
      lines: [
        a.role === 'member'
          ? 'They get an email with a link to join. No staff access.'
          : `They get an email with a link to join, and land with everything ${ROLE_WORDS[a.role]} can do by default.`,
        // The ladder is structural in create_invite and not overridable,
        // so an admin reading this needs to know before they try.
        ...(a.role === 'admin'
          ? ['Only owners can invite admins — this will be refused otherwise.']
          : []),
        `${names} on the team right now.`,
      ],
      yes: 'Yes, send it',
    };
  },
  apply: async (a, ctx) => {
    const { data, error } = await ctx.supabase.functions.invoke('send-invite', {
      body: {
        gym_id: ctx.gymId,
        role: a.role,
        email: a.email,
        // The accept link's host. The edge function needs it to build a
        // URL it cannot know from the request alone.
        origin:
          typeof window !== 'undefined' && window.location
            ? window.location.origin
            : undefined,
      },
    });
    if (error) throw new ActionError(await inviteFailure(error));
    const r = (data ?? {}) as { sent?: boolean; code?: string; error?: string };
    if (r.sent) return `Invite sent to ${a.email}.`;
    // The code is real either way — email delivery is the part that is
    // not set up, and saying "that failed" would be false.
    if (r.code) {
      return (
        `The invite for ${a.email} is ready, but email sending is not set up ` +
        `yet so it has not gone out. Open Team to copy the link and send it ` +
        `yourself.`
      );
    }
    throw new ActionError(r.error ?? 'The invite did not go out.');
  },
};

async function inviteFailure(e: unknown): Promise<string> {
  const ctx = (e as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      const msg = String(body?.error ?? '');
      if (/Only owners can invite/i.test(msg)) {
        return 'Only the owner can invite an owner or an admin.';
      }
      if (msg) return msg;
    } catch {
      // fall through
    }
  }
  return 'The invite did not go out.';
}

// ============================================================================
// team.who
// ============================================================================

type Roster = Record<string, never>;

type RosterRow = {
  role: string;
  profiles: { full_name: string | null } | null;
};

const ROLE_ORDER = ['owner', 'admin', 'coach', 'staff'];

// "Front desk" is already plural in the way people say it; the others
// take an s.
function roleLabel(role: string, count: number): string {
  if (role === 'staff') return 'Front desk';
  const word = role[0].toUpperCase() + role.slice(1);
  return count === 1 ? word : `${word}s`;
}

export const whoIsOnTheTeam: ActionSpec<Roster> = {
  name: 'team.who',
  kind: 'ask',
  capability: 'can_access_staff_area',
  says:
    'Who is on the team — "who works here", "who is on the team", "how ' +
    'many coaches have we got".',
  args: [],
  sanitise: () => ({}) as Roster,
  preview: async (_a, ctx) => {
    const { data, error } = await ctx.supabase
      .from('gym_memberships')
      .select('role, profiles!profile_id(full_name)')
      .eq('gym_id', ctx.gymId)
      .neq('role', 'member')
      .is('left_at', null);
    if (error) return { title: 'I could not read the team.', lines: [] };
    const rows = (data ?? []) as unknown as RosterRow[];
    if (rows.length === 0) return { title: 'Nobody but you.', lines: [] };

    const byRole = new Map<string, string[]>();
    for (const r of rows) {
      const name = r.profiles?.full_name?.trim();
      if (!name) continue;
      byRole.set(r.role, [...(byRole.get(r.role) ?? []), name]);
    }
    const lines = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => {
      const names = byRole.get(role)!.sort();
      return `${roleLabel(role, names.length)}: ${names.join(', ')}`;
    });
    const n = rows.length;
    return { title: `${n} on the team.`, lines };
  },
};

// ============================================================================
// tags.add_rule
// ============================================================================
//
// The other half of members.tag: that one labels a person, this one
// describes a kind of person so the sweep finds them from now on. Every
// predicate here is the tag editor's own; the two that need a class type
// are left off the enum rather than half-supported, so a sentence about
// one falls through to "not from here yet" instead of into a failing
// insert.

type Predicate =
  | 'intro'
  | 'expiring_soon'
  | 'expired'
  | 'paying'
  | 'never_paid'
  | 'inactive'
  | 'cancelling'
  | 'no_recent_attendance'
  | 'joined_within'
  | 'on_plan';

const PREDICATES = [
  'intro',
  'expiring_soon',
  'expired',
  'paying',
  'never_paid',
  'inactive',
  'cancelling',
  'no_recent_attendance',
  'joined_within',
  'on_plan',
] as const;

// The two kinds the CHECK constraint says must carry a number.
const NEEDS_DAYS: Predicate[] = ['no_recent_attendance', 'joined_within'];

const PREDICATE_WORDS: Record<Predicate, string> = {
  intro: 'anyone on an intro or a trial',
  expiring_soon: 'anyone whose membership runs out soon',
  expired: 'anyone whose membership has run out',
  paying: 'anyone who is paying',
  never_paid: 'anyone who has never paid',
  inactive: 'anyone with no live membership',
  cancelling: 'anyone who has given notice',
  no_recent_attendance: 'anyone who has not been in',
  joined_within: 'anyone who joined',
  on_plan: 'anyone on a plan',
};

type TagRule = {
  label: string;
  predicate: Predicate;
  days: number | null;
  plan: string | null;
};

export const addTagRule: ActionSpec<TagRule> = {
  name: 'tags.add_rule',
  kind: 'do',
  capability: 'can_manage_tags',
  says:
    'Label a kind of member automatically, from now on — "tag anyone who ' +
    'has not been in for 30 days as Ghosting", "tag everyone on an intro ' +
    'as New", "tag anyone who has given notice as Leaving". For labelling ' +
    'one person, use members.tag.',
  args: [
    { name: 'label', type: 'string', desc: 'The tag itself, short — one or two words', required: true },
    {
      name: 'predicate',
      type: 'enum',
      values: [...PREDICATES],
      desc:
        'Who it catches. no_recent_attendance = has not trained in N days. ' +
        'joined_within = joined in the last N days. on_plan = is on a named ' +
        'plan. intro / expiring_soon / expired / paying / never_paid / ' +
        'inactive / cancelling are membership standing.',
      required: true,
    },
    {
      name: 'days',
      type: 'integer',
      desc: 'The number of days, for no_recent_attendance and joined_within only.',
      min: 1,
      max: 3650,
    },
    { name: 'plan', type: 'string', desc: 'The plan, for on_plan only' },
  ],
  invalidate: ['tag-rules', 'member-tags', 'members-cohort'],
  sanitise: (raw) => {
    const label = argString(raw, 'label', 40);
    const predicate = argEnum(raw, 'predicate', PREDICATES);
    if (!label || !predicate) return null;
    const days = argInt(raw, 'days', 1, 3650);
    // The CHECK refuses these without a number, so a rule that would be
    // rejected by the database never becomes a card.
    if (NEEDS_DAYS.includes(predicate) && days === null) return null;
    const plan = argString(raw, 'plan', 80);
    if (predicate === 'on_plan' && !plan) return null;
    return {
      label,
      predicate,
      days: NEEDS_DAYS.includes(predicate) ? days : null,
      plan: predicate === 'on_plan' ? plan : null,
    };
  },
  preview: async (a, ctx) => {
    const { data: existing } = await ctx.supabase
      .from('tag_rules')
      .select('label')
      .eq('gym_id', ctx.gymId)
      .ilike('label', a.label);
    if (((existing ?? []) as { label: string }[]).length > 0) {
      return {
        title: `You already have a rule tagging people “${a.label}”.`,
        lines: ['Change it on the tags screen rather than adding a second one.'],
      };
    }
    let planName: string | null = null;
    if (a.plan) {
      const found = await matchPlan(a.plan, ctx);
      if (found.kind === 'none') {
        return { title: `You don't have a plan called “${a.plan}”.`, lines: [] };
      }
      if (found.kind === 'many') {
        return {
          title: `“${a.plan}” could be more than one of your plans — which?`,
          lines: [],
          choices: found.names.map((n) => ({
            label: n,
            args: { label: a.label, predicate: a.predicate, plan: n },
          })),
        };
      }
      planName = found.plan.name;
    }
    return {
      title: `Tag ${describeRule(a, planName)} as “${a.label}”?`,
      lines: [
        'It applies from now on, not just once — anyone who starts matching gets the tag, and anyone who stops loses it.',
        // Both are true and neither is obvious. 0201 made the tag anchor
        // trustworthy precisely so a sequence can fire off it.
        'Members never see it. Tag rules and any automation watching this tag pick it up on the next sweep.',
      ],
      yes: 'Yes, add the rule',
    };
  },
  apply: async (a, ctx) => {
    let planId: string | null = null;
    if (a.plan) {
      const found = await matchPlan(a.plan, ctx);
      if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
      planId = found.plan.plan_id;
    }
    const { error } = await ctx.supabase.from('tag_rules').insert({
      gym_id: ctx.gymId,
      label: a.label,
      color: '#6B7280',
      predicate_kind: a.predicate,
      threshold_days: a.days,
      plan_id: planId,
      class_type_id: null,
      active: true,
      created_by: ctx.userId,
    });
    if (error) {
      throw new ActionError(
        /duplicate key|unique/i.test(error.message)
          ? `You already have a rule tagging people “${a.label}”.`
          : /row-level security|permission/i.test(error.message)
            ? 'You do not have permission to manage tags.'
            : "That didn't save — try again.",
      );
    }
    // Run it now rather than waiting for the nightly sweep, so the
    // receipt can say how many it caught. Failure here is not the rule
    // failing — it exists and the sweep will pick it up.
    const { data: applied } = await ctx.supabase.rpc('apply_tag_rules', {
      p_gym_id: ctx.gymId,
    });
    const n = typeof applied === 'number' ? applied : null;
    return n === null
      ? `Anyone who matches is tagged “${a.label}” from now on.`
      : `“${a.label}” is on ${n} ${n === 1 ? 'member' : 'members'} now, and on anyone who starts matching.`;
  },
};

function describeRule(a: TagRule, planName: string | null): string {
  if (a.predicate === 'no_recent_attendance') {
    return `anyone who has not been in for ${a.days} days`;
  }
  if (a.predicate === 'joined_within') {
    return `anyone who joined in the last ${a.days} days`;
  }
  if (a.predicate === 'on_plan') return `anyone on ${planName ?? a.plan}`;
  return PREDICATE_WORDS[a.predicate];
}

export const TEAM_ACTIONS: AnyAction[] = [
  erase(inviteToTeam),
  erase(whoIsOnTheTeam),
  erase(addTagRule),
];
