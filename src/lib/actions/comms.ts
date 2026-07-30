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
import { renderEmailHtml, renderEmailText } from '../email/render';
import { newsletterDocument } from '../newsletter-draft';
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

async function brandOf(ctx: ActionContext): Promise<Brand | null> {
  const { data } = await ctx.supabase
    .from('gyms')
    .select('name, logo_url, primary_color, secondary_color, text_color')
    .eq('id', ctx.gymId)
    .single();
  return (data as Brand | null) ?? null;
}

function docFor(
  g: Brand | null,
  subject: string,
  sections: { heading: string; body: string }[],
) {
  return newsletterDocument(
    {
      primaryColor: g?.primary_color ?? '#2563EB',
      secondaryColor: g?.secondary_color ?? '#0F172A',
      textColor: g?.text_color ?? '#FFFFFF',
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
): Promise<EmailDraftCard> {
  return {
    ...cardBase(await brandOf(ctx)),
    audience,
    emails: [{ when: null, subject: draft.subject, sections: draft.sections }],
    note: null,
  };
}

export async function sequenceCard(
  d: SequenceDraft,
  ctx: ActionContext,
): Promise<EmailDraftCard> {
  return {
    ...cardBase(await brandOf(ctx)),
    audience: triggerSentence(d),
    emails: d.emails.map((e) => ({
      when: whenLine(e.afterDays),
      subject: e.subject,
      sections: [{ heading: e.heading, body: e.body }],
    })),
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

export const COMMS_ACTIONS: AnyAction[] = [erase(describeSequenceAction)];

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
): Promise<{ def: AudienceDefinition; line: string }> {
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
      line: `No tag here called “${missing.join('” or “')}” — nobody would get this.`,
    };
  }
  const count = await countFor(def, ctx);
  const who = describeAudience(def);
  const missed =
    missing.length > 0 ? ` (no tag called “${missing.join('” or “')}”)` : '';
  return {
    def,
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
