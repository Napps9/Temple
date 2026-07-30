// The scaffolding around the programming, never the programming.
//
// This is where the craft line gets tested hardest, so it is worth
// stating: nothing here writes a workout. Writing a session, editing its
// sections, laying out a member's week — that is a coach with a keyboard
// and a whiteboard in their head, and the editor is the right shape for
// it. The bar's job is to get them there faster.
//
// What the bar can take is the scaffolding. The year plan — "Open prep
// runs January to March" — is a label on a date range that every coach's
// week strip reads, and it lives in a modal three taps from anywhere.
// Individual programming access is a per-member switch with a price
// attached. Whether a plan carries individual programming is one boolean
// on the plan. All three are admin wearing a programming coat.
//
// 0219 is a hard prerequisite, not a nicety: every write below was gated
// on a raw-role helper rather than the capability the screen shows, so
// before that migration a `staff`-role holder granted can_edit_classes
// would have been offered these verbs and refused by the database on
// every one.

import { matchPlan } from './members';
import {
  ActionError,
  argEnum,
  argString,
  erase,
  type ActionContext,
  type ActionPreview,
  type ActionSpec,
  type AnyAction,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EDIT = 'can_edit_classes';

function dayLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  ).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function weeksBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00`);
  const b = Date.parse(`${to}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(1, Math.round((b - a) / (7 * 86_400_000)));
}

// ============================================================================
// Blocks
// ============================================================================

type BlockRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  color: string;
  note: string | null;
};

const BLOCK_SELECT = 'id, name, starts_on, ends_on, color, note';

async function blocks(ctx: ActionContext): Promise<BlockRow[]> {
  const { data } = await ctx.supabase
    .from('programming_blocks')
    .select(BLOCK_SELECT)
    .eq('gym_id', ctx.gymId)
    .order('starts_on', { ascending: true });
  return (data ?? []) as BlockRow[];
}

type BlockFound =
  | { kind: 'one'; block: BlockRow }
  | { kind: 'unresolved'; preview: ActionPreview };

async function findBlock(
  query: string,
  blockId: string | null,
  carry: Record<string, unknown>,
  ctx: ActionContext,
): Promise<BlockFound> {
  const rows = await blocks(ctx);
  if (blockId) {
    const hit = rows.find((r) => r.id === blockId);
    if (hit) return { kind: 'one', block: hit };
  }
  const q = query.toLowerCase().trim();
  const exact = rows.filter((r) => r.name.toLowerCase() === q);
  const hits = exact.length > 0
    ? exact
    : rows.filter((r) => r.name.toLowerCase().includes(q));
  if (hits.length === 1) return { kind: 'one', block: hits[0] };
  if (hits.length > 1) {
    return {
      kind: 'unresolved',
      preview: {
        title: `A few blocks could be “${query}” — which one?`,
        lines: [],
        choices: hits.slice(0, 6).map((h) => ({
          label: `${h.name} — ${dayLabel(h.starts_on)} to ${dayLabel(h.ends_on)}`,
          args: { ...carry, block: h.name, block_id: h.id },
        })),
      },
    };
  }
  return {
    kind: 'unresolved',
    preview: { title: `You have no block called “${query}”.`, lines: [] },
  };
}

// blockForDate breaks ties on the LATEST starts_on (src/lib/programming-
// roadmap.ts), so a block laid over an existing one silently becomes the
// name every coach's week strip shows. Better said on the card.
function overlapping(rows: BlockRow[], from: string, to: string): BlockRow[] {
  return rows.filter((r) => r.starts_on <= to && r.ends_on >= from);
}

type NewBlock = {
  name: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
};

export const blockOut: ActionSpec<NewBlock> = {
  name: 'programming.block_out',
  kind: 'do',
  capability: EDIT,
  says:
    'Name a stretch of the year — "Open prep runs from 6 January to 15 ' +
    'March", "block out a strength cycle for the next 8 weeks", "call ' +
    'February deload". This is the label on the calendar, not the ' +
    'programming itself.',
  args: [
    { name: 'name', type: 'string', desc: 'What the block is called, 2-60 characters', required: true },
    { name: 'starts_on', type: 'date', desc: 'First day, YYYY-MM-DD', required: true },
    { name: 'ends_on', type: 'date', desc: 'Last day, YYYY-MM-DD, on or after the start', required: true },
    { name: 'note', type: 'string', desc: 'A line about the intent, if they gave one' },
  ],
  invalidate: ['programming-blocks'],
  sanitise: (raw) => {
    const name = argString(raw, 'name', 60);
    const startsOn = argString(raw, 'starts_on', 10);
    const endsOn = argString(raw, 'ends_on', 10);
    // The table's own bounds (0205): 2-60 characters, end on or after
    // start, note under 200. A row the CHECK would reject must never
    // become a confirm card.
    if (!name || name.length < 2) return null;
    if (!startsOn || !ISO_DATE.test(startsOn)) return null;
    if (!endsOn || !ISO_DATE.test(endsOn) || endsOn < startsOn) return null;
    return { name, startsOn, endsOn, note: argString(raw, 'note', 200) };
  },
  preview: async (a, ctx) => {
    const over = overlapping(await blocks(ctx), a.startsOn, a.endsOn);
    const weeks = weeksBetween(a.startsOn, a.endsOn);
    return {
      title: `Block out “${a.name}”?`,
      lines: [
        `${dayLabel(a.startsOn)} to ${dayLabel(a.endsOn)} — ${weeks} ${weeks === 1 ? 'week' : 'weeks'}.`,
        // Two things a screen never has to say, and both surprise people.
        'It is the whole gym. A block cannot be set for one class type.',
        over.length > 0
          ? `It overlaps ${over.map((o) => `“${o.name}”`).join(', ')}, and the newer block is the one the week strip shows.`
          : 'It names the weeks; the programming inside them is untouched either way.',
        ...(a.note ? [`“${a.note}”`] : []),
      ],
      yes: 'Yes, block it out',
    };
  },
  apply: async (a, ctx) => {
    const { error } = await ctx.supabase.from('programming_blocks').insert({
      gym_id: ctx.gymId,
      created_by: ctx.userId,
      name: a.name,
      starts_on: a.startsOn,
      ends_on: a.endsOn,
      color: '#3B82F6',
      note: a.note,
    });
    if (error) throw new ActionError(blockFailure(error.message));
    return `“${a.name}” runs ${dayLabel(a.startsOn)} to ${dayLabel(a.endsOn)}.`;
  },
};

type MoveBlock = {
  block: string;
  blockId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  name: string | null;
};

export const moveBlock: ActionSpec<MoveBlock> = {
  name: 'programming.move_block',
  kind: 'do',
  capability: EDIT,
  says:
    'Change a block already on the year — "push Open prep back a week", ' +
    '"make the strength cycle end on 30 April", "rename February deload ' +
    'to Recovery".',
  args: [
    { name: 'block', type: 'string', desc: 'The block, as the owner named it', required: true },
    { name: 'starts_on', type: 'date', desc: 'New first day, YYYY-MM-DD, if it moves' },
    { name: 'ends_on', type: 'date', desc: 'New last day, YYYY-MM-DD, if it moves' },
    { name: 'name', type: 'string', desc: 'A new name, if they are renaming it' },
  ],
  invalidate: ['programming-blocks'],
  sanitise: (raw) => {
    const block = argString(raw, 'block', 60);
    if (!block) return null;
    const startsOn = argString(raw, 'starts_on', 10);
    const endsOn = argString(raw, 'ends_on', 10);
    const name = argString(raw, 'name', 60);
    const id = argString(raw, 'block_id', 64);
    const change = {
      startsOn: startsOn && ISO_DATE.test(startsOn) ? startsOn : null,
      endsOn: endsOn && ISO_DATE.test(endsOn) ? endsOn : null,
      name: name && name.length >= 2 ? name : null,
    };
    // Nothing to change is not a change, and an empty confirm card is
    // worse than saying so.
    if (!change.startsOn && !change.endsOn && !change.name) return null;
    return { block, blockId: id && UUID_RE.test(id) ? id : null, ...change };
  },
  preview: async (a, ctx) => {
    const carry = {
      ...(a.startsOn ? { starts_on: a.startsOn } : {}),
      ...(a.endsOn ? { ends_on: a.endsOn } : {}),
      ...(a.name ? { name: a.name } : {}),
    };
    const found = await findBlock(a.block, a.blockId, carry, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const b = found.block;
    const starts = a.startsOn ?? b.starts_on;
    const ends = a.endsOn ?? b.ends_on;
    if (ends < starts) {
      return { title: 'That would end the block before it starts.', lines: [] };
    }
    return {
      title: `Change “${b.name}”?`,
      lines: [
        ...(a.name ? [`Renamed to “${a.name}”.`] : []),
        starts !== b.starts_on || ends !== b.ends_on
          ? `${dayLabel(b.starts_on)}–${dayLabel(b.ends_on)} → ${dayLabel(starts)}–${dayLabel(ends)}.`
          : 'The dates stay as they are.',
        // The thing everyone assumes and nobody is told.
        'The programming written in those weeks does not move. A block is a label over dates, not a container.',
      ],
      yes: 'Yes, change it',
    };
  },
  apply: async (a, ctx) => {
    const found = await findBlock(a.block, a.blockId, {}, ctx);
    if (found.kind !== 'one') throw new ActionError('That block is no longer there.');
    const { error } = await ctx.supabase
      .from('programming_blocks')
      .update({
        ...(a.name ? { name: a.name } : {}),
        ...(a.startsOn ? { starts_on: a.startsOn } : {}),
        ...(a.endsOn ? { ends_on: a.endsOn } : {}),
      })
      .eq('id', found.block.id);
    if (error) throw new ActionError(blockFailure(error.message));
    return `“${a.name ?? found.block.name}” now runs ${dayLabel(a.startsOn ?? found.block.starts_on)} to ${dayLabel(a.endsOn ?? found.block.ends_on)}.`;
  },
};

type DropBlock = { block: string; blockId: string | null };

export const dropBlock: ActionSpec<DropBlock> = {
  name: 'programming.drop_block',
  kind: 'do',
  capability: EDIT,
  says:
    'Take a block off the year — "drop Open prep", "get rid of the ' +
    'February deload block".',
  args: [
    { name: 'block', type: 'string', desc: 'The block, as the owner named it', required: true },
  ],
  invalidate: ['programming-blocks'],
  sanitise: (raw) => {
    const block = argString(raw, 'block', 60);
    if (!block) return null;
    const id = argString(raw, 'block_id', 64);
    return { block, blockId: id && UUID_RE.test(id) ? id : null };
  },
  preview: async (a, ctx) => {
    const found = await findBlock(a.block, a.blockId, {}, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const b = found.block;
    const under = overlapping(await blocks(ctx), b.starts_on, b.ends_on).filter(
      (o) => o.id !== b.id,
    );
    return {
      title: `Drop “${b.name}” off the year?`,
      lines: [
        `${dayLabel(b.starts_on)} to ${dayLabel(b.ends_on)}.`,
        'The programming written in those weeks stays exactly as it is — what goes is the label.',
        ...(under.length > 0
          ? [`${under.map((o) => `“${o.name}”`).join(', ')} sits underneath and becomes the one the week strip shows.`]
          : []),
      ],
      yes: 'Yes, drop it',
    };
  },
  apply: async (a, ctx) => {
    const found = await findBlock(a.block, a.blockId, {}, ctx);
    if (found.kind !== 'one') throw new ActionError('That block is no longer there.');
    const { error } = await ctx.supabase
      .from('programming_blocks')
      .delete()
      .eq('id', found.block.id);
    if (error) throw new ActionError(blockFailure(error.message));
    return `“${found.block.name}” is off the year. The programming in those weeks is untouched.`;
  },
};

function blockFailure(message: string): string {
  if (/row-level security|permission/i.test(message)) {
    return 'You do not have permission to change the programming calendar.';
  }
  if (/programming_blocks_window_ck/i.test(message)) {
    return 'A block cannot end before it starts.';
  }
  if (/char_length/i.test(message)) {
    return 'That name is too short or too long — two to sixty characters.';
  }
  return "That didn't save — try again.";
}

// ============================================================================
// Who is on individual programming
// ============================================================================

type Access = {
  member: string;
  profileId: string | null;
  mode: 'free' | 'paid';
  product: string | null;
};

type CohortRow = {
  profile_id: string;
  profiles: { full_name: string | null } | null;
};

async function matchMember(
  query: string,
  ctx: ActionContext,
): Promise<{ id: string; name: string }[]> {
  const { data } = await ctx.supabase
    .from('v_member_cohort')
    .select('profile_id, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId);
  const rows = ((data ?? []) as unknown as CohortRow[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({ id: r.profile_id, name: r.profiles!.full_name!.trim() }));
  const q = query.toLowerCase().trim();
  const exact = rows.filter((r) => r.name.toLowerCase() === q);
  if (exact.length > 0) return exact;
  const first = rows.filter((r) => r.name.toLowerCase().split(/\s+/)[0] === q);
  if (first.length > 0) return first;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

export const setProgrammingAccess: ActionSpec<Access> = {
  name: 'programming.set_access',
  kind: 'do',
  capability: 'can_program_members',
  says:
    'Say whether a member pays for their individual programming — "put ' +
    'Marcus on the paid PT programming", "Sarah gets her programming ' +
    'free", "charge Dan for one-to-one programming".',
  args: [
    { name: 'member', type: 'string', desc: 'The person, as the owner named them', required: true },
    {
      name: 'mode',
      type: 'enum',
      values: ['free', 'paid'],
      desc: 'free = included, paid = they buy it from the shop',
      required: true,
    },
    {
      name: 'product',
      type: 'string',
      desc: 'The shop product they buy it through, required when paid',
    },
  ],
  invalidate: [
    'member-programming-access',
    'programmed-members',
    'my-programming-access',
  ],
  sanitise: (raw) => {
    const member = argString(raw, 'member', 60);
    const mode = argEnum(raw, 'mode', ['free', 'paid'] as const);
    if (!member || !mode) return null;
    const product = argString(raw, 'product', 80);
    // The RPC refuses paid with no product, so a card that could only
    // ever fail is never built.
    if (mode === 'paid' && !product) return null;
    const id = argString(raw, 'profile_id', 64);
    return {
      member,
      mode,
      product: mode === 'paid' ? product : null,
      profileId: id && UUID_RE.test(id) ? id : null,
    };
  },
  preview: async (a, ctx) => {
    const carry = {
      mode: a.mode,
      ...(a.product ? { product: a.product } : {}),
    };
    let profileId = a.profileId;
    let name = a.member;
    if (!profileId) {
      const hits = await matchMember(a.member, ctx);
      if (hits.length === 0) {
        return { title: `No one called “${a.member}” on your books.`, lines: [] };
      }
      if (hits.length > 1) {
        return {
          title: `A few people could be “${a.member}” — which one?`,
          lines: [],
          choices: hits.slice(0, 6).map((h) => ({
            label: h.name,
            args: { ...carry, member: h.name, profile_id: h.id },
          })),
        };
      }
      profileId = hits[0].id;
      name = hits[0].name;
    }

    let productName: string | null = null;
    if (a.product) {
      const { data } = await ctx.supabase
        .from('store_products')
        .select('id, name')
        .eq('gym_id', ctx.gymId)
        .is('archived_at', null);
      const rows = (data ?? []) as { id: string; name: string }[];
      const q = a.product.toLowerCase().trim();
      const hit =
        rows.find((r) => r.name.toLowerCase() === q) ??
        rows.filter((r) => r.name.toLowerCase().includes(q))[0];
      if (!hit) {
        return { title: `Nothing in your shop called “${a.product}”.`, lines: [] };
      }
      productName = hit.name;
    }

    return {
      title:
        a.mode === 'free'
          ? `Give ${name} their individual programming free?`
          : `Charge ${name} for individual programming?`,
      lines:
        a.mode === 'free'
          ? [
              'They see whatever you write for them, at no cost.',
              'Free is also what happens with no setting at all, so this only changes anything if they were on paid.',
            ]
          : [
              `They buy it through ${productName}.`,
              // The two facts the modal never has to state and the sentence
              // absolutely must, because both are ways of being wrong.
              'With no setting at all a member is free by default, so this takes away access they have today.',
              'Anyone on a plan that includes individual programming keeps it regardless — the plan wins.',
            ],
      yes: a.mode === 'free' ? 'Yes, make it free' : 'Yes, charge for it',
    };
  },
  apply: async (a, ctx) => {
    const hits = a.profileId
      ? [{ id: a.profileId, name: a.member }]
      : await matchMember(a.member, ctx);
    if (hits.length !== 1) throw new ActionError("I couldn't find them.");
    let productId: string | null = null;
    if (a.product) {
      const { data } = await ctx.supabase
        .from('store_products')
        .select('id, name')
        .eq('gym_id', ctx.gymId)
        .is('archived_at', null);
      const rows = (data ?? []) as { id: string; name: string }[];
      const q = a.product.toLowerCase().trim();
      const hit =
        rows.find((r) => r.name.toLowerCase() === q) ??
        rows.filter((r) => r.name.toLowerCase().includes(q))[0];
      if (!hit) throw new ActionError('That shop item is no longer there.');
      productId = hit.id;
    }
    const { error } = await ctx.supabase.rpc('set_member_programming_access', {
      p_gym_id: ctx.gymId,
      p_profile_id: hits[0].id,
      p_mode: a.mode,
      p_store_product_id: productId,
    });
    if (error) {
      throw new ActionError(
        /Not authorised/i.test(error.message)
          ? 'You do not have permission to set that.'
          : "That didn't save — try again.",
      );
    }
    return a.mode === 'free'
      ? `${hits[0].name}'s individual programming is free.`
      : `${hits[0].name} pays for their individual programming.`;
  },
};

type Programmed = Record<string, never>;

type ProgrammedRow = {
  full_name: string | null;
  mode: string | null;
  upcoming_days: number | null;
  last_date: string | null;
};

export const whoIsProgrammed: ActionSpec<Programmed> = {
  name: 'programming.who_is_programmed',
  kind: 'ask',
  capability: 'can_program_members',
  says:
    'Who is on individual programming — "who am I programming for", ' +
    '"who is running out of programming", "how many people are on one to one".',
  args: [],
  sanitise: () => ({}) as Programmed,
  preview: async (_a, ctx) => {
    const { data, error } = await ctx.supabase.rpc('list_programmed_members', {
      p_gym_id: ctx.gymId,
    });
    if (error) {
      return { title: 'I could not read who is on individual programming.', lines: [] };
    }
    const rows = (data ?? []) as ProgrammedRow[];
    if (rows.length === 0) {
      return { title: 'Nobody is on individual programming.', lines: [] };
    }
    // Who runs out first, which is the question behind the question. The
    // list screen sorts by name and never answers it.
    const sorted = [...rows].sort(
      (x, y) => (x.upcoming_days ?? 0) - (y.upcoming_days ?? 0),
    );
    const empty = sorted.filter((r) => (r.upcoming_days ?? 0) === 0);
    const paid = rows.filter((r) => r.mode === 'paid').length;
    return {
      title: `${rows.length} on individual programming${paid > 0 ? `, ${paid} paying` : ''}.`,
      lines: [
        ...(empty.length > 0
          ? [
              `${empty.length} ${empty.length === 1 ? 'has' : 'have'} nothing written ahead: ` +
                empty
                  .slice(0, 5)
                  .map((r) => r.full_name ?? 'someone')
                  .join(', ') +
                (empty.length > 5 ? ` and ${empty.length - 5} more` : '') +
                '.',
            ]
          : []),
        ...sorted
          .filter((r) => (r.upcoming_days ?? 0) > 0)
          .slice(0, 5)
          .map(
            (r) =>
              `${r.full_name ?? 'Someone'} — ${r.upcoming_days} ${r.upcoming_days === 1 ? 'day' : 'days'} written ahead.`,
          ),
        // upcoming_days counts rows dated today or later, so the number is
        // days-with-something-on-them and not a run of consecutive days.
        'Days ahead counts days you have written, today onwards.',
      ],
    };
  },
};

// ============================================================================
// Whether a plan carries it
// ============================================================================

type PlanProgramming = { plan: string; included: boolean };

export const setPlanProgramming: ActionSpec<PlanProgramming> = {
  name: 'plans.include_programming',
  kind: 'do',
  capability: 'can_manage_plans',
  says:
    'Say whether a membership plan comes with individual programming — ' +
    '"Unlimited includes one-to-one programming", "take individual ' +
    'programming off the off-peak plan".',
  args: [
    { name: 'plan', type: 'string', desc: 'The plan, as the owner named it', required: true },
    {
      name: 'included',
      type: 'boolean',
      desc: 'True to include individual programming, false to take it off',
      required: true,
    },
  ],
  invalidate: ['membership-plans', 'membership-plans-active'],
  sanitise: (raw) => {
    const plan = argString(raw, 'plan', 80);
    if (!plan || typeof raw.included !== 'boolean') return null;
    return { plan, included: raw.included };
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
        choices: found.names.map((n) => ({
          label: n,
          args: { plan: n, included: a.included },
        })),
      };
    }
    const plan = found.plan;
    // A programming_only plan is nothing but individual programming; the
    // CHECK at 0123:116 refuses the row without the flag.
    if (plan.kind === 'programming_only' && !a.included) {
      return {
        title: `${plan.name} is a programming-only plan, so it cannot stop including programming.`,
        lines: ['There would be nothing left of it. Archive it instead.'],
      };
    }
    const { count } = await ctx.supabase
      .from('plan_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', ctx.gymId)
      .eq('plan_id', plan.plan_id)
      .in('status', ['active', 'cancelled_at_period_end', 'refunded_retained']);
    const on = count ?? 0;
    return {
      title: a.included
        ? `Include individual programming in ${plan.name}?`
        : `Take individual programming off ${plan.name}?`,
      lines: [
        // Unlike a price change, this one IS retroactive — the access
        // check reads plan_subscriptions live rather than a snapshot.
        on === 0
          ? 'Nobody is on it, so this only affects who signs up next.'
          : a.included
            ? `The ${on} ${on === 1 ? 'member' : 'members'} already on it get it straight away, not just new sign-ups.`
            : `The ${on} ${on === 1 ? 'member' : 'members'} already on it lose it straight away, unless they have been given it individually.`,
      ],
      yes: a.included ? 'Yes, include it' : 'Yes, take it off',
    };
  },
  apply: async (a, ctx) => {
    const found = await matchPlan(a.plan, ctx);
    if (found.kind !== 'one') throw new ActionError('That plan is no longer there.');
    const { error } = await ctx.supabase
      .from('membership_plans')
      .update({ includes_individual_programming: a.included })
      .eq('gym_id', ctx.gymId)
      .eq('plan_id', found.plan.plan_id);
    if (error) {
      throw new ActionError(
        /programming_only_includes/i.test(error.message)
          ? 'A programming-only plan has to include programming.'
          : /row-level security|permission/i.test(error.message)
            ? 'You do not have permission to change plans.'
            : "That didn't save — try again.",
      );
    }
    return a.included
      ? `${found.plan.name} now includes individual programming.`
      : `${found.plan.name} no longer includes individual programming.`;
  },
};

export const PROGRAMMING_ACTIONS: AnyAction[] = [
  erase(blockOut),
  erase(moveBlock),
  erase(dropBlock),
  erase(setProgrammingAccess),
  erase(whoIsProgrammed),
  erase(setPlanProgramming),
];
