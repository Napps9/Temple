// The team, and the labels that sort the members.
//
// Two thin modules together, because both are mostly one job each and
// neither earns a file of its own.
//
// The team, whole: bring somebody in, ask who is here, change what
// somebody is, and take somebody off. The last two had no write anywhere
// in Temple until 0223 — no RPC, no screen, no client update — so "make
// Jo an admin" meant deleting Jo and re-inviting her, and losing the
// membership row and everything hanging off it.
//
// Tag rules are the other half of `members.tag`: that one labels a
// person, this one describes a kind of person and lets the sweep find
// them. The predicate set is the tag editor's own (0200), minus the two
// that need a class type — those want a second name resolved and are
// better said on the screen than guessed at here.

import { matchMembers } from '../chat-lookup';
import {
  describeTagRule,
  type TagRule as StoredTagRule,
} from '../tag-rules';
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
// Gated on can_invite, which is the switch the invite form on the members
// screen reads and, as of 0218, the one create_invite enforces. The two
// used to disagree: the screen showed the box on can_invite and the
// database asked for can_manage_staff, so an owner who granted "Send
// invites" to a coach gave them a button that failed.
//
// `admin` stays in the enum because an owner can legitimately invite one,
// and the card warns anybody else before they try — create_invite's
// owner-only ladder is structural and cannot be granted. `owner` is left
// off on purpose: handing your gym to somebody is not a thing to do by
// saying a sentence, even though the database would allow it.

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
  capability: 'can_invite',
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

// ============================================================================
// team.set_role and team.remove
// ============================================================================
//
// Both go through the ladder in 0223, which is structural rather than
// capability-driven: an owner or an admin can only be changed or removed
// by an owner, and a gym always keeps at least one owner. Those rules
// live in SQL because they are what makes granting the capability safe,
// and a rule the client enforces is a rule an owner can be talked out of.
//
// The bar's job is to say the refusal in the words the owner used, and to
// be clear which of the two things is happening. "He's not coaching any
// more" is a role change and keeps the membership; "he has left" is a
// removal and takes the bookings, the subscription and the health data
// with it. Reading one as the other is not recoverable in the second
// direction, so the cards say plainly which one they are.

const ROLE_VALUES = ['owner', 'admin', 'coach', 'staff', 'member'] as const;
type Role = (typeof ROLE_VALUES)[number];

const ROLE_SAID: Record<Role, string> = {
  owner: 'an owner',
  admin: 'an admin',
  coach: 'a coach',
  staff: 'front desk',
  member: 'an ordinary member',
};

type PersonRow = { profile_id: string; role: string; name: string };

// The whole roster, members included: a role change is as often a
// promotion out of the membership as a move between staff jobs, and
// resolveTarget only sees members.
async function everyone(ctx: ActionContext): Promise<PersonRow[]> {
  const { data } = await ctx.supabase
    .from('gym_memberships')
    .select('profile_id, role, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId)
    .is('left_at', null);
  return ((data ?? []) as unknown as {
    profile_id: string;
    role: string;
    profiles: { full_name: string | null } | null;
  }[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({
      profile_id: r.profile_id,
      role: r.role,
      name: r.profiles!.full_name!.trim(),
    }));
}

type Resolved =
  | { kind: 'one'; person: PersonRow }
  | { kind: 'none' }
  | { kind: 'many'; hits: PersonRow[] };

async function whoTheyMeant(who: string, ctx: ActionContext): Promise<Resolved> {
  const hits = matchMembers(await everyone(ctx), who);
  if (hits.length === 0) return { kind: 'none' };
  if (hits.length === 1) return { kind: 'one', person: hits[0] };
  return { kind: 'many', hits };
}

// The RPCs raise in words. These are the ones an owner can act on; the
// rest are plumbing and get the generic line.
export function rosterFailure(message: string): string {
  if (/needs an owner/i.test(message)) {
    return 'A gym needs an owner. Make someone else an owner first, then try again.';
  }
  if (/Only owners can make/i.test(message)) {
    return 'Only the owner can make somebody an owner or an admin.';
  }
  if (/Only owners can change/i.test(message)) {
    return 'Only the owner can change what an owner or an admin is.';
  }
  if (/Only owners can remove/i.test(message)) {
    return 'Only the owner can take an owner or an admin off the team.';
  }
  if (/not at this gym/i.test(message)) return 'They are not at this gym.';
  if (/row-level security|Not authorised/i.test(message)) {
    return 'You do not have permission to change the team.';
  }
  return "That didn't save — try again.";
}

export const setTeamRole: ActionSpec<{ who: string; role: Role }> = {
  name: 'team.set_role',
  kind: 'do',
  capability: 'can_manage_staff',
  says:
    'Change what somebody is at the gym — "make Jo an admin", "Marcus is ' +
    'a coach now", "put Sam on the front desk", "Dan is not coaching any ' +
    'more, just a member". Not for taking somebody off the team, which is ' +
    'team.remove.',
  args: [
    { name: 'who', type: 'string', desc: 'The person, as the owner named them', required: true },
    {
      name: 'role',
      type: 'enum',
      desc:
        'What they become. "front desk" or "reception" is staff; "just a ' +
        'member" or "not coaching any more" is member.',
      values: [...ROLE_VALUES],
      required: true,
    },
  ],
  invalidate: ['staff-roster', 'coach-roster', 'gym-member-names', 'members-cohort'],
  sanitise: (raw) => {
    const who = argString(raw, 'who', 80);
    const role = argEnum(raw, 'role', ROLE_VALUES);
    return who && role ? { who, role } : null;
  },
  preview: async (a, ctx) => {
    const found = await whoTheyMeant(a.who, ctx);
    if (found.kind === 'none') {
      return { title: `Nobody here called “${a.who}”.`, lines: [] };
    }
    if (found.kind === 'many') {
      return {
        title: `A few people could be “${a.who}” — which one?`,
        lines: [],
        choices: found.hits.map((h) => ({
          label: `${h.name} (${ROLE_SAID[h.role as Role] ?? h.role})`,
          args: { who: h.name, role: a.role },
        })),
      };
    }
    const p = found.person;
    if (p.role === a.role) {
      return { title: `${p.name} is already ${ROLE_SAID[a.role]}.`, lines: [] };
    }
    const down = a.role === 'member' && p.role !== 'member';
    return {
      title: `Make ${p.name} ${ROLE_SAID[a.role]}?`,
      lines: [
        `They are ${ROLE_SAID[p.role as Role] ?? p.role} now.`,
        down
          ? 'They stay at the gym — this only takes away the staff side. Their bookings and history are untouched.'
          : 'They keep everything they have; this only changes what they can do.',
        'Anything you switched on for them personally goes back to whatever the new role gets.',
      ],
      yes: `Yes, make them ${ROLE_SAID[a.role]}`,
    };
  },
  apply: async (a, ctx) => {
    const found = await whoTheyMeant(a.who, ctx);
    if (found.kind !== 'one') throw new ActionError('I lost track of who you meant.');
    const p = found.person;
    const { error } = await ctx.supabase.rpc('set_member_role', {
      p_gym_id: ctx.gymId,
      p_profile_id: p.profile_id,
      p_role: a.role,
    });
    if (error) throw new ActionError(rosterFailure(error.message));
    ctx.offer?.('The team', '/management/roster');
    return `${p.name} is ${ROLE_SAID[a.role]} now.`;
  },
};

export const removeFromTeam: ActionSpec<{ who: string }> = {
  name: 'team.remove',
  kind: 'do',
  capability: 'can_archive_members',
  says:
    'Take somebody off — "Marcus has left", "take Jo off the team", ' +
    '"remove Sam". Not for changing what somebody does, which is ' +
    'team.set_role.',
  args: [
    { name: 'who', type: 'string', desc: 'The person, as the owner named them', required: true },
  ],
  invalidate: [
    'staff-roster',
    'coach-roster',
    'members-cohort',
    'gym-member-names',
    'class-sessions-month',
  ],
  sanitise: (raw) => {
    const who = argString(raw, 'who', 80);
    return who ? { who } : null;
  },
  preview: async (a, ctx) => {
    const found = await whoTheyMeant(a.who, ctx);
    if (found.kind === 'none') {
      return { title: `Nobody here called “${a.who}”.`, lines: [] };
    }
    if (found.kind === 'many') {
      return {
        title: `A few people could be “${a.who}” — which one?`,
        lines: [],
        choices: found.hits.map((h) => ({
          label: `${h.name} (${ROLE_SAID[h.role as Role] ?? h.role})`,
          args: { who: h.name },
        })),
      };
    }
    const p = found.person;
    // Counted rather than described, because "and their bookings" reads
    // as boilerplate and "and their four bookings this week" reads as a
    // decision. Same reads the Remove dialog on the members screen makes.
    const [bookings, subs] = await Promise.all([
      ctx.supabase
        .from('class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', p.profile_id),
      ctx.supabase
        .from('plan_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', ctx.gymId)
        .eq('profile_id', p.profile_id)
        .eq('status', 'active'),
    ]);
    const b = bookings.count ?? 0;
    const sub = (subs.count ?? 0) > 0;
    return {
      title: `Take ${p.name} off the team?`,
      lines: [
        `They are ${ROLE_SAID[p.role as Role] ?? p.role} now.`,
        b > 0
          ? `Their ${b} upcoming booking${b === 1 ? '' : 's'} ${b === 1 ? 'is' : 'are'} cancelled.`
          : 'They have nothing booked.',
        sub
          ? 'Their membership is cancelled — no more payments are taken.'
          : 'They have no live membership.',
        'Their health answers are erased. This is not something I can undo.',
      ],
      yes: 'Yes, take them off',
    };
  },
  apply: async (a, ctx) => {
    const found = await whoTheyMeant(a.who, ctx);
    if (found.kind !== 'one') throw new ActionError('I lost track of who you meant.');
    const p = found.person;
    const { error } = await ctx.supabase.rpc('leave_gym', {
      p_gym_id: ctx.gymId,
      p_profile_id: p.profile_id,
    });
    if (error) throw new ActionError(rosterFailure(error.message));
    ctx.offer?.('The team', '/management/roster');
    return `${p.name} is off the team. Their bookings are cancelled and their health answers are gone.`;
  },
};

type RuleRow = Pick<
  StoredTagRule,
  'id' | 'label' | 'predicate_kind' | 'threshold_days' | 'active'
> & { class_type_id: string | null; plan_id: string | null };

async function rules(ctx: ActionContext): Promise<RuleRow[]> {
  const { data, error } = await ctx.supabase
    .from('tag_rules')
    .select('id, label, predicate_kind, threshold_days, class_type_id, plan_id, active')
    .eq('gym_id', ctx.gymId)
    .order('label');
  if (error) throw new ActionError('I could not read the tag rules.');
  return (data ?? []) as unknown as RuleRow[];
}

// ============================================================================
// tags.rules
// ============================================================================

export const listTagRules: ActionSpec<Record<string, never>> = {
  name: 'tags.rules',
  kind: 'ask',
  capability: 'can_manage_tags',
  says:
    'What tags the gym applies by itself — "what tags am I applying", ' +
    '"what are my tag rules", "how is everyone getting tagged".',
  args: [],
  sanitise: () => ({}) as Record<string, never>,
  preview: async (_a, ctx) => {
    const rows = await rules(ctx);
    const on = rows.filter((r) => r.active);
    if (rows.length === 0) {
      return {
        title: 'Nothing is being tagged automatically.',
        lines: [
          'Every tag on a member right now was put there by hand.',
          'Say something like “tag anyone who hasn’t been in for 30 days as Drifting”.',
        ],
      };
    }
    return {
      title:
        on.length === rows.length
          ? `${rows.length} rule${rows.length === 1 ? '' : 's'} are tagging members for you.`
          : `${on.length} of ${rows.length} rules are tagging members for you.`,
      lines: [
        'They run over the whole roster, so a member can pick up or lose a tag without anybody touching them.',
        ...(on.length < rows.length
          ? ['The rest are switched off and tag nobody.']
          : []),
      ],
      answer: {
        figure: { value: String(on.length), label: 'tagging automatically' },
        // Rules are instructions, not quantities — a rail beside one
        // would rank it above another, which is not a thing.
        list: {
          label: 'What each one does',
          rows: rows.map((r) => ({
            name: r.label,
            detail: r.active ? describeTagRule(r) : 'off',
          })),
        },
      },
    };
  },
};

// ============================================================================
// tags.remove_rule
// ============================================================================

type DropRule = { label: string };

export const removeTagRule: ActionSpec<DropRule> = {
  name: 'tags.remove_rule',
  kind: 'do',
  capability: 'can_manage_tags',
  says:
    'Stop tagging a group automatically — "stop tagging people Drifting", ' +
    '"get rid of the New tag rule".',
  args: [
    {
      name: 'label',
      type: 'string',
      desc: 'The tag the rule applies, as they named it.',
      required: true,
    },
  ],
  invalidate: ['tag-rules', 'member-tags', 'member-tags-for', 'members-cohort'],
  sanitise: (raw) => {
    const label = argString(raw, 'label', 40);
    return label ? { label } : null;
  },
  preview: async (a, ctx) => {
    const hits = (await rules(ctx)).filter((r) =>
      r.label.toLowerCase().includes(a.label.toLowerCase()),
    );
    if (hits.length === 0) {
      return {
        title: `No rule here tags anybody “${a.label}”.`,
        lines: ['Say “what tags am I applying” to see the ones that exist.'],
      };
    }
    if (hits.length > 1) {
      return {
        title: `A few rules could be “${a.label}” — which one?`,
        lines: [],
        choices: hits.map((h) => ({ label: h.label, args: { label: h.label } })),
      };
    }
    return {
      title: `Stop tagging people ${hits[0].label}?`,
      lines: [
        describeTagRule(hits[0]) + '.',
        // The rule goes; the tags it put on people go with it, because
        // they were never anybody's judgement. A tag somebody added by
        // hand is a different row and is not touched.
        'The tag comes off everyone it put it on. Tags added by hand stay.',
      ],
      yes: 'Yes, stop it',
    };
  },
  apply: async (a, ctx) => {
    const hits = (await rules(ctx)).filter(
      (r) => r.label.toLowerCase() === a.label.toLowerCase(),
    );
    if (hits.length !== 1) {
      throw new ActionError('That rule moved while we were talking — try again.');
    }
    const { error } = await ctx.supabase
      .from('tag_rules')
      .delete()
      .eq('id', hits[0].id);
    if (error) throw new ActionError(error.message);
    return `Nobody is being tagged ${hits[0].label} any more.`;
  },
};

export const TEAM_ACTIONS: AnyAction[] = [
  erase(inviteToTeam),
  erase(whoIsOnTheTeam),
  erase(setTeamRole),
  erase(removeFromTeam),
  erase(addTagRule),
  erase(listTagRules),
  erase(removeTagRule),
];
