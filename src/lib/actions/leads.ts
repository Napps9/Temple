// The people who haven't joined yet.
//
// The pipeline is the one board in Temple that is genuinely a queue of
// small decisions — took the call, booked them in, they came, they didn't
// — and a board is a bad shape for that. Every card on it is one sentence
// of news ("Sarah's booked her intro") and the board's whole job is to be
// the place you go to type it in.
//
// So the verbs are the news: someone rang, they moved, give them to
// somebody, and who's out there. The board keeps its screen for the
// genuine survey — it is in the Back Office per the roadmap — and none of
// the machinery underneath changes: assignment rules still fire on
// capture, the notification queue still goes out, the AI front desk still
// works the same rows.
//
// Everything here runs on `can_assign_plan`, which is the capability the
// leads screen has always gated itself on. As of 0217 it is also the
// capability the RPCs enforce.

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAPABILITY = 'can_assign_plan';

type LeadStatus =
  | 'cold'
  | 'contacted'
  | 'intro_booked'
  | 'trial_attended'
  | 'converted'
  | 'lost';

// The five an owner can set by saying so. `converted` is deliberately not
// here: set_lead_status refuses it without a member profile, because a
// conversion is a link to a real account rather than a label, and a verb
// that could only ever fail is worse than no verb.
const SETTABLE: LeadStatus[] = [
  'cold',
  'contacted',
  'intro_booked',
  'trial_attended',
  'lost',
];

const STATUS_WORDS: Record<LeadStatus, string> = {
  cold: 'not spoken to yet',
  contacted: 'spoken to',
  intro_booked: 'booked in for an intro',
  trial_attended: 'been in for a trial',
  converted: 'joined',
  lost: 'not interested',
};

type LeadRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  captured_at: string;
  assigned_coach_id: string | null;
};

const LEAD_SELECT =
  'id, full_name, email, phone, status, captured_at, assigned_coach_id';

function dayLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  ).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// Same posture as the member matcher: an exact name answers outright, a
// fragment that fits more than one person is a question rather than a
// guess. Archived and converted rows are out — they are not the pipeline
// any more, and matching them would resolve "Sarah" to somebody who
// joined last year.
function matchLeads(rows: LeadRow[], query: string): LeadRow[] {
  const q = query.toLowerCase().trim();
  const exact = rows.filter((r) => r.full_name.toLowerCase() === q);
  if (exact.length > 0) return exact;
  const first = rows.filter(
    (r) => r.full_name.toLowerCase().split(/\s+/)[0] === q,
  );
  if (first.length > 0) return first;
  return rows.filter((r) => r.full_name.toLowerCase().includes(q));
}

async function openLeads(ctx: ActionContext): Promise<LeadRow[]> {
  const { data } = await ctx.supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('gym_id', ctx.gymId)
    .is('archived_at', null)
    .neq('status', 'converted')
    .order('captured_at', { ascending: false });
  return (data ?? []) as LeadRow[];
}

type Found =
  | { kind: 'one'; lead: LeadRow }
  | { kind: 'unresolved'; preview: ActionPreview };

async function findLead(
  query: string,
  leadId: string | null,
  carry: Record<string, unknown>,
  ctx: ActionContext,
): Promise<Found> {
  const rows = await openLeads(ctx);
  if (leadId) {
    const hit = rows.find((r) => r.id === leadId);
    if (hit) return { kind: 'one', lead: hit };
  }
  const hits = matchLeads(rows, query);
  if (hits.length === 1) return { kind: 'one', lead: hits[0] };
  if (hits.length > 1) {
    return {
      kind: 'unresolved',
      preview: {
        title: `A few enquiries could be “${query}” — which one?`,
        lines: [],
        choices: hits.slice(0, 6).map((h) => ({
          label: `${h.full_name} — ${STATUS_WORDS[h.status]}`,
          args: { ...carry, lead: h.full_name, lead_id: h.id },
        })),
      },
    };
  }
  return {
    kind: 'unresolved',
    preview: { title: `No open enquiry from anyone called “${query}”.`, lines: [] },
  };
}

function readLeadId(raw: Record<string, unknown>): string | null {
  const id = argString(raw, 'lead_id', 64);
  return id && UUID_RE.test(id) ? id : null;
}

// ============================================================================
// leads.add
// ============================================================================

type AddLead = {
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  notes: string | null;
};

async function matchSource(
  query: string,
  ctx: ActionContext,
): Promise<{ id: string; label: string } | null> {
  const { data } = await ctx.supabase
    .from('lead_sources')
    .select('id, label')
    .eq('gym_id', ctx.gymId)
    .is('archived_at', null);
  const rows = (data ?? []) as { id: string; label: string }[];
  const q = query.toLowerCase().trim();
  const exact = rows.find((r) => r.label.toLowerCase() === q);
  if (exact) return exact;
  const near = rows.filter(
    (r) => r.label.toLowerCase().includes(q) || q.includes(r.label.toLowerCase()),
  );
  return near.length === 1 ? near[0] : null;
}

export const addLead: ActionSpec<AddLead> = {
  name: 'leads.add',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Take down an enquiry — "someone rang, Sarah Jones, 07700 900123", ' +
    '"add a lead, Dan Webb, dan@example.com, found us on Instagram", ' +
    '"a walk-in just came in asking about memberships, Jo Patel".',
  args: [
    { name: 'name', type: 'string', desc: 'Their name, as the owner said it', required: true },
    { name: 'email', type: 'string', desc: 'Their email, if they gave one' },
    { name: 'phone', type: 'string', desc: 'Their phone number, if they gave one' },
    {
      name: 'source',
      type: 'string',
      desc:
        'Where they came from, if they said — "Instagram", "walk-in", "a ' +
        'friend". Only what the owner stated.',
    },
    {
      name: 'notes',
      type: 'string',
      desc: 'Anything else worth remembering about the enquiry, in their words',
    },
  ],
  invalidate: [
    'leads',
    'leads-new-count',
    'leads-lifecycle-summary',
    'lead-notifications',
    'unread-lead-notifications',
  ],
  sanitise: (raw) => {
    const name = argString(raw, 'name', 80);
    if (!name) return null;
    return {
      name,
      email: argString(raw, 'email', 120),
      phone: argString(raw, 'phone', 40),
      source: argString(raw, 'source', 60),
      notes: argString(raw, 'notes', 500),
    };
  },
  preview: async (a, ctx) => {
    // Somebody who rang twice is one person, not two rows on the board.
    const existing = matchLeads(await openLeads(ctx), a.name);
    if (existing.length > 0) {
      return {
        title: `${existing[0].full_name} is already on your list — ${STATUS_WORDS[existing[0].status]}.`,
        lines: [`Came in on ${dayLabel(existing[0].captured_at)}.`],
      };
    }
    const source = a.source ? await matchSource(a.source, ctx) : null;
    return {
      title: `Take down ${a.name} as an enquiry?`,
      lines: [
        a.email || a.phone
          ? [a.email, a.phone].filter(Boolean).join(' · ')
          : 'No contact details — you will have to catch them at the gym.',
        a.source && !source
          ? `You have no source called “${a.source}”, so it goes down without one.`
          : source
            ? `Source: ${source.label}`
            : 'No source recorded.',
        // Capture is the trigger for both, and an owner who did not know
        // that would think the enquiry sat there untouched.
        'Your assignment rule picks who it goes to, and the front desk starts working it.',
        ...(a.notes ? [`“${a.notes}”`] : []),
      ],
      yes: 'Yes, take it down',
    };
  },
  apply: async (a, ctx) => {
    const source = a.source ? await matchSource(a.source, ctx) : null;
    const { error } = await ctx.supabase.rpc('record_lead', {
      p_gym_id: ctx.gymId,
      p_full_name: a.name,
      p_email: a.email,
      p_phone: a.phone,
      p_source_id: source?.id ?? null,
      p_notes: a.notes,
    });
    if (error) throw new ActionError(leadFailure(error.message));
    return `${a.name} is on your list.`;
  },
};

// ============================================================================
// leads.set_status
// ============================================================================

type MoveLead = { lead: string; status: LeadStatus; leadId: string | null };

export const moveLead: ActionSpec<MoveLead> = {
  name: 'leads.set_status',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Move an enquiry along — "Sarah\'s booked her intro", "I spoke to Dan", ' +
    '"Jo came in for her trial", "we lost Marcus, he went elsewhere".',
  args: [
    { name: 'lead', type: 'string', desc: 'The person who enquired, as the owner named them', required: true },
    {
      name: 'status',
      type: 'enum',
      values: SETTABLE,
      desc:
        'Where they have got to. cold = not spoken to. contacted = spoken ' +
        'to. intro_booked = booked in. trial_attended = they came. lost = ' +
        'not interested or gone elsewhere.',
      required: true,
    },
  ],
  invalidate: [
    'leads',
    'leads-new-count',
    'leads-lifecycle-summary',
    'lead-notifications',
    'unread-lead-notifications',
  ],
  sanitise: (raw) => {
    const lead = argString(raw, 'lead', 80);
    const status = argEnum(raw, 'status', SETTABLE);
    if (!lead || !status) return null;
    return { lead, status, leadId: readLeadId(raw) };
  },
  preview: async (a, ctx) => {
    const found = await findLead(a.lead, a.leadId, { status: a.status }, ctx);
    if (found.kind === 'unresolved') return found.preview;
    const lead = found.lead;
    if (lead.status === a.status) {
      return {
        title: `${lead.full_name} is already down as ${STATUS_WORDS[a.status]}.`,
        lines: [],
      };
    }
    return {
      title: `Mark ${lead.full_name} as ${STATUS_WORDS[a.status]}?`,
      lines: [
        `They were ${STATUS_WORDS[lead.status]}, since ${dayLabel(lead.captured_at)}.`,
        // 0150: acting on a lead retires the chase. Better said than
        // discovered when the follow-up never arrives.
        'Any follow-up you had queued for them stops.',
        ...(a.status === 'lost'
          ? ['They come off the board. Nothing else goes out to them.']
          : []),
      ],
      yes: `Yes, mark them ${STATUS_WORDS[a.status]}`,
    };
  },
  apply: async (a, ctx) => {
    const found = await findLead(a.lead, a.leadId, {}, ctx);
    if (found.kind !== 'one') throw new ActionError("I couldn't find that enquiry.");
    const { error } = await ctx.supabase.rpc('set_lead_status', {
      p_lead_id: found.lead.id,
      p_status: a.status,
    });
    if (error) throw new ActionError(leadFailure(error.message));
    return `${found.lead.full_name} is down as ${STATUS_WORDS[a.status]}.`;
  },
};

// ============================================================================
// leads.assign
// ============================================================================

type AssignLead = { lead: string; coach: string; leadId: string | null };

type CoachRow = { profile_id: string; profiles: { full_name: string | null } | null };

async function matchCoach(
  query: string,
  ctx: ActionContext,
): Promise<{ id: string; name: string } | null> {
  const { data } = await ctx.supabase
    .from('gym_memberships')
    .select('profile_id, profiles!profile_id(full_name)')
    .eq('gym_id', ctx.gymId)
    .is('left_at', null)
    .neq('role', 'member');
  const staff = ((data ?? []) as unknown as CoachRow[])
    .filter((r) => r.profiles?.full_name?.trim())
    .map((r) => ({ id: r.profile_id, name: r.profiles!.full_name!.trim() }));
  const q = query.toLowerCase().trim();
  const exact = staff.find((s) => s.name.toLowerCase() === q);
  if (exact) return exact;
  const first = staff.filter((s) => s.name.toLowerCase().split(/\s+/)[0] === q);
  if (first.length === 1) return first[0];
  const near = staff.filter((s) => s.name.toLowerCase().includes(q));
  return near.length === 1 ? near[0] : null;
}

export const assignLeadTo: ActionSpec<AssignLead> = {
  name: 'leads.assign',
  kind: 'do',
  capability: CAPABILITY,
  says:
    'Hand an enquiry to someone on the team — "give Sarah to Marcus", ' +
    '"Dan\'s enquiry is Jo\'s", "put me on the new enquiry".',
  args: [
    { name: 'lead', type: 'string', desc: 'The person who enquired', required: true },
    { name: 'coach', type: 'string', desc: 'Who on the team should take it', required: true },
  ],
  invalidate: [
    'leads',
    'leads-new-count',
    'leads-lifecycle-summary',
    'lead-notifications',
    'unread-lead-notifications',
  ],
  sanitise: (raw) => {
    const lead = argString(raw, 'lead', 80);
    const coach = argString(raw, 'coach', 60);
    if (!lead || !coach) return null;
    return { lead, coach, leadId: readLeadId(raw) };
  },
  preview: async (a, ctx) => {
    const [found, coach] = await Promise.all([
      findLead(a.lead, a.leadId, { coach: a.coach }, ctx),
      matchCoach(a.coach, ctx),
    ]);
    if (found.kind === 'unresolved') return found.preview;
    if (!coach) {
      return { title: `Nobody on your team answers to “${a.coach}”.`, lines: [] };
    }
    if (found.lead.assigned_coach_id === coach.id) {
      return {
        title: `${found.lead.full_name} is already ${coach.name}'s.`,
        lines: [],
      };
    }
    return {
      title: `Give ${found.lead.full_name} to ${coach.name}?`,
      lines: [
        `${found.lead.full_name} is ${STATUS_WORDS[found.lead.status]}.`,
        `${coach.name} gets told, and the enquiry shows as theirs.`,
      ],
      yes: 'Yes, hand it over',
    };
  },
  apply: async (a, ctx) => {
    const [found, coach] = await Promise.all([
      findLead(a.lead, a.leadId, {}, ctx),
      matchCoach(a.coach, ctx),
    ]);
    if (found.kind !== 'one') throw new ActionError("I couldn't find that enquiry.");
    if (!coach) throw new ActionError('Nobody on your team answers to that.');
    const { error } = await ctx.supabase.rpc('set_lead_assignee', {
      p_lead_id: found.lead.id,
      p_coach_id: coach.id,
    });
    if (error) throw new ActionError(leadFailure(error.message));
    return `${found.lead.full_name} is ${coach.name}'s now.`;
  },
};

// ============================================================================
// leads.pipeline
// ============================================================================
//
// The board as an answer. An owner asking "who's enquired" wants the shape
// of the week, not six columns to read across: how many came in, how many
// are waiting on a call, who is booked in, and — the one the board is
// worst at — who has been sitting there untouched.

type Pipeline = { days: number };

export const leadPipeline: ActionSpec<Pipeline> = {
  name: 'leads.pipeline',
  kind: 'ask',
  capability: CAPABILITY,
  says:
    'How the enquiries are going — "who has enquired this week", "how is ' +
    'the pipeline looking", "any new leads", "who have we not called back".',
  args: [
    {
      name: 'days',
      type: 'integer',
      desc: 'How far back they asked about. 7 if they did not say.',
      min: 1,
      max: 365,
    },
  ],
  sanitise: (raw) => {
    const v = raw.days;
    const n = typeof v === 'string' ? Number(v) : v;
    const days =
      typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 365
        ? Math.round(n)
        : 7;
    return { days };
  },
  preview: async (a, ctx) => {
    const rows = await openLeads(ctx);
    const since = Date.now() - a.days * 86_400_000;
    const fresh = rows.filter((r) => Date.parse(r.captured_at) >= since);
    const period = a.days === 7 ? 'this week' : `in the last ${a.days} days`;
    if (rows.length === 0) {
      return { title: 'Nobody is on your enquiries list.', lines: [] };
    }
    const count = (s: LeadStatus) => rows.filter((r) => r.status === s).length;
    const waiting = count('cold');
    const booked = count('intro_booked');
    const tried = count('trial_attended');

    // The one a board hides: an enquiry nobody has spoken to, days old.
    const stale = rows.filter(
      (r) =>
        r.status === 'cold' &&
        Date.parse(r.captured_at) < Date.now() - 2 * 86_400_000,
    );

    return {
      title:
        fresh.length === 0
          ? `No new enquiries ${period}. ${rows.length} still open.`
          : `${fresh.length} ${fresh.length === 1 ? 'enquiry' : 'enquiries'} ${period}, ${rows.length} open in all.`,
      lines: [
        `${waiting} not spoken to, ${booked} booked in, ${tried} been in for a trial.`,
        ...(stale.length > 0
          ? [
              `${stale.length} ${stale.length === 1 ? 'has' : 'have'} been waiting more than two days: ` +
                stale
                  .slice(0, 4)
                  .map((r) => r.full_name)
                  .join(', ') +
                (stale.length > 4 ? ` and ${stale.length - 4} more` : '') +
                '.',
            ]
          : []),
      ],
    };
  },
};

// The RPCs raise in words; these are the ones an owner can act on.
function leadFailure(message: string): string {
  if (/Not authorised/i.test(message)) {
    return 'You do not have permission to work the enquiries.';
  }
  if (/Name is required/i.test(message)) return 'I need a name to take it down.';
  if (/Lead not found/i.test(message)) return 'That enquiry is no longer there.';
  if (/member profile is required/i.test(message)) {
    return 'Marking someone as joined needs their member account, so that one is still the leads screen.';
  }
  if (/does not belong to this gym|not a member of this gym/i.test(message)) {
    return 'That belongs to another gym.';
  }
  return "That didn't save — try again.";
}

export const LEAD_ACTIONS: AnyAction[] = [
  erase(addLead),
  erase(moveLead),
  erase(assignLeadTo),
  erase(leadPipeline),
];
