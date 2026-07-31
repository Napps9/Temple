// Reaching members, as things you can say.
//
// The newsletter has been a sentence since phase 6; what it could never
// say was *who it was for*. It always drafted to all_members, so "tell
// the lapsed lot we miss them" produced a campaign addressed to everyone
// and the owner had to go and fix it on the screen — which is most of the
// work the sentence was supposed to remove. It now takes an audience,
// resolves it against the gym's real tags, and puts the recipient count
// on the card before anyone confirms.
//
// And a sequence is described rather than built. That is the first thing
// the bar has drafted that keeps running after the conversation ends, so
// it lands switched off and says so on the card: describing a program is
// drafting it, turning it on is still a human act. Same rule as the
// newsletter's send button, for the same reason.

import {
  DEFAULT_AUDIENCE,
  describeAudience,
  type AudienceDefinition,
  type CohortKey,
} from '../email/audience';
import { FALLBACK_BRAND_SEED } from '../email/blocks';
import { renderEmailHtml, renderEmailText } from '../email/render';
import { newsletterDocument, sanitiseNewsletter } from '../newsletter-draft';
import {
  parseWallTime,
  sendAtEpoch,
  sendAtLabel,
  untilLabel,
  type WallTime,
} from '../send-time';
import {
  primaryRow,
  sanitiseSequence,
  stepRows,
  triggerSentence,
  whenLine,
  type SequenceDraft,
} from '../sequence-draft';

import {
  ActionError,
  argString,
  erase,
  gymTimezone,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';
import type { Json } from '../../types/database';

const COHORTS: CohortKey[] = [
  'intro',
  'active',
  'paying',
  'expiring_soon',
  'expired',
];

// A list argument arrives as whatever the model felt like sending. Take
// the strings, drop the rest, cap it — the same posture as every other
// sanitiser here.
function argStrings(raw: unknown, max: number, each = 40): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, max)) {
    if (typeof v !== 'string') continue;
    const s = v.trim().replace(/\s+/g, ' ');
    if (s.length > 0) out.push(s.slice(0, each));
  }
  return out;
}

// Tags first: naming one is more specific than naming a cohort, so a
// sentence that does both means the tag.
export function audienceFrom(
  tags: string[],
  cohorts: string[],
): AudienceDefinition {
  if (tags.length > 0) return { kind: 'tags', tags };
  const valid = cohorts.filter((c): c is CohortKey =>
    (COHORTS as string[]).includes(c),
  );
  if (valid.length > 0) return { kind: 'cohort', cohorts: valid };
  return DEFAULT_AUDIENCE;
}

// "the injured lot" is not a tag; "Injured" is. Match what the owner said
// against the labels the gym actually uses, case-insensitively, because a
// tag audience that resolves to nothing sends to nobody and looks like it
// worked.
async function realTags(
  wanted: string[],
  ctx: ActionContext,
): Promise<{ found: string[]; missing: string[] }> {
  if (wanted.length === 0) return { found: [], missing: [] };
  const { data } = await ctx.supabase
    .from('member_tags')
    .select('label')
    .eq('gym_id', ctx.gymId);
  const labels = new Set(
    ((data ?? []) as { label: string }[]).map((r) => r.label),
  );
  const lower = new Map([...labels].map((l) => [l.toLowerCase(), l]));
  const found: string[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const hit = lower.get(w.toLowerCase());
    if (hit) found.push(hit);
    else missing.push(w);
  }
  return { found, missing };
}

async function countFor(
  def: AudienceDefinition,
  ctx: ActionContext,
): Promise<number | null> {
  const { data, error } = await ctx.supabase.rpc('comms_audience_count', {
    p_gym_id: ctx.gymId,
    p_definition: def as unknown as Json,
    p_topic_id: null,
  });
  return error ? null : ((data as number) ?? 0);
}

type Brand = {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  text_color: string | null;
};

export async function brandOf(ctx: ActionContext): Promise<Brand | null> {
  const { data } = await ctx.supabase
    .from('gyms')
    .select('name, logo_url, primary_color, secondary_color, text_color')
    .eq('id', ctx.gymId)
    .single();
  return (data as Brand | null) ?? null;
}

// One builder for the card and for the write. They used to be two copies
// of the same four lines, which is how the preview and the thing actually
// saved get to disagree without anybody noticing.
//
// The fallbacks are the block kit's own (#0F172A text), not white. The
// previous copy fell back to #FFFFFF, which is white body text on the
// white content panel — unreadable. gyms.text_color is NOT NULL so it
// never bit in production, but it fires the moment that select comes back
// empty, and an unreadable draft is not something a fallback should be
// able to produce.
export function docFor(
  g: Brand | null,
  subject: string,
  sections: { heading: string; body: string }[],
) {
  return newsletterDocument(
    {
      primaryColor: g?.primary_color ?? FALLBACK_BRAND_SEED.primaryColor,
      secondaryColor: g?.secondary_color ?? FALLBACK_BRAND_SEED.secondaryColor,
      textColor: g?.text_color ?? FALLBACK_BRAND_SEED.textColor,
    },
    { gymName: g?.name ?? 'Your gym', logoUrl: g?.logo_url ?? null },
    { subject, sections },
  );
}

// ============================================================================
// The draft, in the chat
// ============================================================================
//
// A confirm card that says "Rehab class starts Monday — A new small-group
// session for anyone…" tells an owner it is roughly about the right thing.
// It does not tell them whether it is any good, which is the only question
// they actually have. So the card renders the draft: the gym's own colour
// and logo at the top, the subject as a subject, and every section in
// full — near enough to what lands in the member's inbox to be worth
// reading, without pretending to be an email client.
//
// One shape for both verbs. A newsletter is one email with no timing; a
// sequence is several, each with the moment it goes.

export type EmailDraftCard = {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string;
  // Who it reaches, already counted — null for a sequence, where the
  // trigger is the audience.
  audience: string | null;
  emails: {
    when: string | null;
    subject: string;
    sections: { heading: string; body: string }[];
    // The compiled email itself — the same HTML the send worker posts,
    // logo and all. Rendered in an iframe on web, where it is exact.
    // Native has no WebView in this app, so the card falls back to the
    // sections above, which is why both are carried.
    html: string;
  }[];
  // The thing an owner must not discover later, if there is one.
  note: string | null;
};

function cardBase(g: Brand | null): Omit<EmailDraftCard, 'emails' | 'audience' | 'note'> {
  return {
    gymName: g?.name ?? 'Your gym',
    logoUrl: g?.logo_url ?? null,
    primaryColor: g?.primary_color ?? '#2563EB',
  };
}

export async function newsletterCard(
  draft: { subject: string; sections: { heading: string; body: string }[] },
  audience: string,
  ctx: ActionContext,
  extra: { when?: string; note?: string } = {},
): Promise<EmailDraftCard> {
  const g = await brandOf(ctx);
  return {
    ...cardBase(g),
    audience,
    emails: [
      {
        when: extra.when ?? null,
        subject: draft.subject,
        sections: draft.sections,
        // Built with the same function AND the same render context apply
        // will use, so what is on the card is not a rendering of the draft
        // — it is the draft. The footer is the gym's real business name
        // and address; without it the card showed an email two lines
        // shorter than the one that lands. unsubscribeUrl is the one
        // deliberate difference: the worker substitutes a per-recipient
        // link, and there is no per-recipient here.
        html: renderEmailHtml(docFor(g, draft.subject, draft.sections), {
          preheader: '',
          footer: await footerOf(ctx, g),
          unsubscribeUrl: '#',
        }),
      },
    ],
    note: extra.note ?? null,
  };
}

export async function sequenceCard(
  d: SequenceDraft,
  ctx: ActionContext,
): Promise<EmailDraftCard> {
  const g = await brandOf(ctx);
  return {
    ...cardBase(g),
    audience: triggerSentence(d),
    emails: d.emails.map((e) => {
      const sections = [{ heading: e.heading, body: e.body }];
      return {
        when: whenLine(e.afterDays),
        subject: e.subject,
        sections,
        html: renderEmailHtml(docFor(g, e.subject, sections)),
      };
    }),
    note: 'It goes in switched off. Read it through, then turn it on.',
  };
}

// ============================================================================
// comms.describe_sequence
// ============================================================================

export const describeSequenceAction: ActionSpec<{ draft: SequenceDraft }> = {
  name: 'comms.describe_sequence',
  kind: 'do',
  capability: 'can_manage_comms',
  says:
    'Set up a series of emails that sends itself — "when someone joins, ' +
    'welcome them and check in after a week", "email members who have not ' +
    'been in for a month", "when I tag someone VIP, send them the members\' ' +
    'guide". For a one-off email to everyone, use comms.draft_newsletter.',
  args: [
    {
      name: 'sequence',
      type: 'object',
      desc:
        '{name, trigger, tag, threshold, emails: [{after_days, subject, ' +
        'heading, body}]} — trigger is one of member_joined, ' +
        'member_first_class, member_inactive, member_tagged, lead_cold. ' +
        '`tag` only for member_tagged (the exact label they named). ' +
        '`threshold` only for member_inactive (days quiet) and lead_cold ' +
        '(hours quiet). `after_days` is measured from the trigger, not from ' +
        'the previous email, so a welcome then a week later is 0 and 7. ' +
        'WRITE the emails: 1-4 of them, each a short subject plus a heading ' +
        'and 1-3 sentences of warm, plain British English. Use ONLY facts ' +
        'the owner stated — never invent dates, times, prices or names.',
      required: true,
    },
  ],
  invalidate: ['email-automations'],
  sanitise: (raw) => {
    const draft = sanitiseSequence(raw.sequence);
    return draft ? { draft } : null;
  },
  preview: async (a, ctx) => {
    // A tag nobody has been given fires for nobody. Worth saying before
    // it is created, not after it has quietly sent nothing for a month.
    if (a.draft.tag) {
      const { missing } = await realTags([a.draft.tag], ctx);
      if (missing.length > 0) {
        return {
          title: `Nobody at your gym is tagged “${a.draft.tag}”, so this would never fire.`,
          lines: ['Tag someone with it first, then describe the sequence again.'],
        };
      }
    }
    return {
      title: `Set up “${a.draft.name}”?`,
      lines: [],
      card: 'email',
      data: await sequenceCard(a.draft, ctx),
      yes: 'Yes, set it up',
    };
  },
  apply: async (a, ctx) => {
    const d = a.draft;
    const g = await brandOf(ctx);
    const row = primaryRow(d);
    const first = d.emails[0];
    const primaryDoc = docFor(g, first.subject, [
      { heading: first.heading, body: first.body },
    ]);

    const { data, error } = await ctx.supabase
      .from('email_automations')
      .insert({
        gym_id: ctx.gymId,
        created_by: ctx.userId,
        name: row.name,
        trigger_type: row.trigger_type,
        delay_minutes: row.delay_minutes,
        params: row.params as unknown as Json,
        subject: row.subject,
        design: primaryDoc as unknown as Json,
        compiled_html: renderEmailHtml(primaryDoc),
        compiled_text: renderEmailText(primaryDoc),
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new ActionError(
        /row-level security|permission/i.test(error?.message ?? '')
          ? 'You do not have permission to set up automations.'
          : "That didn't save — try again.",
      );
    }
    const automationId = (data as { id: string }).id;

    const steps = stepRows(d);
    if (steps.length > 0) {
      const rows = steps.map((s, i) => {
        const email = d.emails[i + 1];
        const doc = docFor(g, email.subject, [
          { heading: email.heading, body: email.body },
        ]);
        return {
          automation_id: automationId,
          gym_id: ctx.gymId,
          step_index: s.step_index,
          delay_minutes: s.delay_minutes,
          subject: s.subject,
          design: doc as unknown as Json,
          compiled_html: renderEmailHtml(doc),
          compiled_text: renderEmailText(doc),
        };
      });
      const { error: stepErr } = await ctx.supabase
        .from('email_automation_steps')
        .insert(rows);
      // The automation itself is real and disabled, so a half-written
      // sequence is safe — but the owner has to be told which half.
      if (stepErr) {
        ctx.offer?.('Open it', `/management/communications/automations/${automationId}`);
        throw new ActionError(
          `“${d.name}” was created with its first email, but the follow-ups did not save. It is switched off — open it and add them.`,
        );
      }
    }

    ctx.offer?.('Open it', `/management/communications/automations/${automationId}`);
    const n = d.emails.length;
    return (
      `“${d.name}” is set up — ${n} email${n === 1 ? '' : 's'}, switched off. ` +
      `Read it through and turn it on when you are happy.`
    );
  },
};


// ============================================================================
// The newsletter's audience
// ============================================================================
//
// Lives here rather than in gym.ts because it is comms machinery, and the
// newsletter action imports it. Exported for the action and for tests.

export type NewsletterAudience = {
  tags: string[];
  cohorts: string[];
};

export function readAudienceArgs(
  raw: Record<string, unknown>,
): NewsletterAudience {
  return {
    tags: argStrings(raw.tags, 6),
    cohorts: argStrings(raw.cohorts, 5, 20),
  };
}

// What the card says about who it is for, once the tags have been checked
// against the gym's own labels and the server has counted them.
export async function audienceLine(
  wanted: NewsletterAudience,
  ctx: ActionContext,
): Promise<{ def: AudienceDefinition; line: string; count: number | null }> {
  const { found, missing } = await realTags(wanted.tags, ctx);
  // Falling back to everyone because a tag was misheard would mail the
  // whole gym. Keep the tag audience, empty, and let the line say so.
  const def = audienceFrom(
    wanted.tags.length > 0 ? found : [],
    wanted.cohorts,
  );
  if (wanted.tags.length > 0 && found.length === 0) {
    return {
      def,
      count: 0,
      line: `No tag here called “${missing.join('” or “')}” — nobody would get this.`,
    };
  }
  const count = await countFor(def, ctx);
  const who = describeAudience(def);
  const missed =
    missing.length > 0 ? ` (no tag called “${missing.join('” or “')}”)` : '';
  return {
    def,
    count,
    line:
      count === null
        ? `To: ${who}${missed}`
        : `To ${who} — ${count} ${count === 1 ? 'person' : 'people'}${missed}.`,
  };
}

export const AUDIENCE_ARGS = [
  {
    name: 'tags',
    type: 'list' as const,
    desc:
      'Member tags to send to, exactly as the owner named them, only if ' +
      'they named any ("everyone on the injured tag" → ["injured"]). Omit ' +
      'for everybody.',
  },
  {
    name: 'cohorts',
    type: 'list' as const,
    desc:
      'Only if they named a group rather than a tag. Any of: intro, ' +
      'active, paying, expiring_soon, expired. "lapsed" or "people who have ' +
      'left" is ["expired"]; "people about to run out" is ["expiring_soon"].',
  },
];

// ============================================================================
// comms.schedule_send
// ============================================================================
//
// The newsletter has always been draftable by sentence and sendable only
// by button, because the button was the approval. Scheduling breaks that:
// nobody is standing at the screen at seven on Sunday morning, so the
// approval has to happen now for a thing that happens later.
//
// The owner's condition for allowing it was that the card show what is
// being approved rather than describe it. So this card renders the
// compiled email — the same HTML the worker will post — names the
// audience with its count, and states the exact local time and how far
// away that is. Then it stays cancellable: comms.cancel_send pulls it
// back to a draft, and so does the campaign screen, right up until the
// dispatcher takes it.
//
// Two writes, deliberately not wrapped in one. If the draft saves and the
// schedule does not, the owner has a draft — which is recoverable and
// visible — and is told exactly that. Rolling the draft back would leave
// them with nothing and a sentence they would have to type again.

type Scheduled = {
  draft: { subject: string; sections: { heading: string; body: string }[] };
  audience: NewsletterAudience;
  when: WallTime;
};

// What the editor puts in the footer, so a scheduled send is byte-for-byte
// what pressing Send on the screen would have produced.
async function footerOf(ctx: ActionContext, g: Brand | null) {
  const { data } = await ctx.supabase
    .from('gym_comms_settings')
    .select('footer_business_name, footer_address')
    .eq('gym_id', ctx.gymId)
    .maybeSingle();
  const row = data as
    | { footer_business_name: string | null; footer_address: string | null }
    | null;
  return {
    businessName: row?.footer_business_name || (g?.name ?? null),
    address: row?.footer_address ?? '',
  };
}

export const scheduleSend: ActionSpec<Scheduled> = {
  name: 'comms.schedule_send',
  kind: 'do',
  capability: 'can_manage_comms',
  says:
    'Write an email to the members and send it at a set time — "email ' +
    'everyone about the Christmas hours on Friday morning", "tell the ' +
    'lapsed lot we miss them, send it Monday at 9". Without a time it is ' +
    'comms.draft_newsletter.',
  args: [
    {
      name: 'newsletter',
      type: 'object',
      desc:
        '{subject, sections: [{heading, body}]} — DRAFT it for them: a short ' +
        'subject line and 2-4 sections, each a heading plus 1-3 sentences of ' +
        "warm, plain British English written from the owner's brief. Use ONLY " +
        'facts they stated — never invent dates, times, prices or names.',
      required: true,
    },
    {
      name: 'send_on',
      type: 'date',
      desc: 'The day it goes, YYYY-MM-DD, resolved forward from today',
      required: true,
    },
    {
      name: 'send_time',
      type: 'string',
      desc:
        'The time it goes, HH:MM on a 24-hour clock, in the gym\'s own local ' +
        'time ("9 in the morning" is 09:00, "half seven in the evening" is ' +
        '19:30). If they named a day but no time, use 09:00.',
      required: true,
    },
    ...AUDIENCE_ARGS,
  ],
  invalidate: ['comms-campaigns', 'comms-campaign'],
  sanitise: (raw) => {
    const draft = sanitiseNewsletter(raw.newsletter);
    const when = parseWallTime(raw.send_on, raw.send_time);
    if (!draft || !when) return null;
    return { draft, audience: readAudienceArgs(raw), when };
  },
  preview: async (a, ctx) => {
    const tz = await gymTimezone(ctx);
    const at = sendAtEpoch(a.when, tz, Date.now());
    if (at === null) {
      return {
        title: 'That time has already gone, or is more than a year out.',
        lines: ['Give me a day and time still ahead of us and I will set it.'],
      };
    }
    const { line, count } = await audienceLine(a.audience, ctx);
    // The campaign screen will not let you send to nobody. Scheduling to
    // nobody is worse than sending to nobody, because the failure is a
    // week away: _send_due_campaign marks the campaign failed, returns
    // zero and tells no one. A draft is allowed to be addressed to an
    // empty group — you open it and fix the audience. A booked send is
    // not, because nobody opens it again.
    if (count === 0) {
      return {
        title: 'Nobody is in that group, so this would go to no one.',
        lines: [
          line,
          'Pick a group with somebody in it and I will book the time.',
        ],
      };
    }
    const label = sendAtLabel(at, tz);
    return {
      title: `Send this ${label}?`,
      lines: [],
      card: 'email',
      data: await newsletterCard(a.draft, line, ctx, {
        when: `${label} — ${untilLabel(at, Date.now())}`,
        // Three things an owner would otherwise learn the hard way, in
        // the order they matter. The zone, because "09:00" is only a fact
        // once you know whose clock. The not-before, because the
        // dispatcher runs every fifteen minutes and an owner told "09:00"
        // who sees it land at 09:12 has been misled. And the deadline on
        // calling it off, phrased as a time rather than "until it sends"
        // — the window really does close, and somebody who learns to
        // trust the looser wording will one day lose the race.
        note:
          `Times are the gym's (${tz}), and it goes at that time or shortly after. ` +
          `Call it off any time before then; once it starts going it cannot be called back. ` +
          `Who gets it is worked out when it goes, so anyone joining or leaving between now and then counts.`,
      }),
      yes: 'Yes, schedule it',
    };
  },
  apply: async (a, ctx) => {
    const tz = await gymTimezone(ctx);
    const at = sendAtEpoch(a.when, tz, Date.now());
    if (at === null) throw new ActionError('That time has already gone.');
    // Re-resolved rather than carried from the preview, same as the
    // newsletter: a tag renamed between the card opening and Yes changes
    // who this reaches, and the send is a week away.
    const { def } = await audienceLine(a.audience, ctx);
    const g = await brandOf(ctx);
    const doc = docFor(g, a.draft.subject, a.draft.sections);

    const { data, error } = await ctx.supabase
      .from('email_campaigns')
      .insert({
        gym_id: ctx.gymId,
        created_by: ctx.userId,
        title: a.draft.subject,
        subject: a.draft.subject,
        design: doc as unknown as Json,
        audience: def as unknown as Json,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new ActionError(
        /row-level security|permission/i.test(error?.message ?? '')
          ? 'You do not have permission to write to members.'
          : "That didn't save — try again.",
      );
    }
    const id = (data as { id: string }).id;
    const href = `/management/communications/${id}`;

    const footer = await footerOf(ctx, g);
    const { error: schedErr } = await ctx.supabase.rpc(
      'comms_schedule_campaign',
      {
        p_campaign_id: id,
        p_send_at: new Date(at).toISOString(),
        p_html: renderEmailHtml(doc, { preheader: '', footer }),
        p_text: renderEmailText(doc, { footer }),
      },
    );
    // Stop and say where. The draft is real, saved and openable — the one
    // thing an owner must not do is walk away believing it is booked.
    if (schedErr) {
      ctx.offer?.('Open it', href);
      throw new ActionError(
        `“${a.draft.subject}” is drafted, but I could not book the time — it is sitting in your campaigns as a draft, unsent. Open it and schedule it there.`,
      );
    }

    ctx.offer?.('Open it', href);
    const label = sendAtLabel(at, tz);
    return (
      `Scheduled — “${a.draft.subject}” goes to ${describeAudience(def).toLowerCase()} on ${label}. ` +
      `Say "don't send the ${a.draft.subject} email" any time before then and I will pull it.`
    );
  },
};

// ============================================================================
// comms.cancel_send
// ============================================================================
//
// The other half of the promise. A scheduled send is only really
// cancellable if calling it off is as easy as booking it was — otherwise
// "you can always cancel" means "you can always go and find the screen".

type ScheduledRow = {
  id: string;
  title: string;
  subject: string;
  scheduled_for: string | null;
};

async function scheduledCampaigns(ctx: ActionContext): Promise<ScheduledRow[]> {
  const { data } = await ctx.supabase
    .from('email_campaigns')
    .select('id, title, subject, scheduled_for')
    .eq('gym_id', ctx.gymId)
    .eq('status', 'scheduled')
    .order('scheduled_for', { ascending: true });
  return (data ?? []) as ScheduledRow[];
}

function matchScheduled(rows: ScheduledRow[], q: string | null): ScheduledRow[] {
  if (rows.length === 0) return [];
  if (!q) return rows;
  const needle = q.toLowerCase();
  const hits = rows.filter(
    (r) =>
      r.subject.toLowerCase().includes(needle) ||
      r.title.toLowerCase().includes(needle),
  );
  return hits.length > 0 ? hits : [];
}

export const cancelSend: ActionSpec<{ which: string | null }> = {
  name: 'comms.cancel_send',
  kind: 'do',
  capability: 'can_manage_comms',
  says:
    'Call off an email that is waiting to go — "don\'t send the Christmas ' +
    'hours email", "cancel Monday\'s newsletter", "stop that email going ' +
    'out".',
  args: [
    {
      name: 'which',
      type: 'string',
      desc:
        'The email, as they named it — words from its subject. Omit if they ' +
        'did not say which.',
    },
  ],
  invalidate: ['comms-campaigns', 'comms-campaign'],
  sanitise: (raw) => ({ which: argString(raw, 'which', 120) }),
  preview: async (a, ctx) => {
    const rows = await scheduledCampaigns(ctx);
    if (rows.length === 0) {
      return { title: 'Nothing is waiting to go out.', lines: [] };
    }
    const hits = matchScheduled(rows, a.which);
    if (hits.length === 0) {
      return {
        title: `Nothing scheduled matching “${a.which}”.`,
        lines: rows.map((r) => `Waiting: “${r.subject}”`),
      };
    }
    if (hits.length > 1) {
      return {
        title: 'Which one?',
        lines: [],
        choices: hits.map((r) => ({ label: r.subject, args: { which: r.subject } })),
      };
    }
    const tz = await gymTimezone(ctx);
    const row = hits[0];
    return {
      title: `Call off “${row.subject}”?`,
      lines: [
        row.scheduled_for
          ? `It was going out ${sendAtLabel(new Date(row.scheduled_for).getTime(), tz)}.`
          : 'It was waiting to go.',
        'It goes back to a draft — nothing is deleted, and you can send it or reschedule it whenever.',
      ],
      yes: 'Yes, call it off',
    };
  },
  apply: async (a, ctx) => {
    const hits = matchScheduled(await scheduledCampaigns(ctx), a.which);
    if (hits.length !== 1) {
      throw new ActionError('That one is no longer waiting to go.');
    }
    const row = hits[0];
    const { error } = await ctx.supabase.rpc('comms_unschedule_campaign', {
      p_campaign_id: row.id,
    });
    if (error) {
      // The dispatcher takes a campaign by flipping it off 'scheduled', so
      // losing the race means it has already gone. Saying "cancelled"
      // would be the worst possible lie here.
      throw new ActionError(
        /not scheduled/i.test(error.message)
          ? `“${row.subject}” has already gone out — I was too late to stop it.`
          : "That didn't save — try again.",
      );
    }
    ctx.offer?.('Open it', `/management/communications/${row.id}`);
    return `Called off. “${row.subject}” is back to a draft and nobody has had it.`;
  },
};

export const COMMS_ACTIONS: AnyAction[] = [
  erase(describeSequenceAction),
  erase(scheduleSend),
  erase(cancelSend),
];
