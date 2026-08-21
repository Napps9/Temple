// The gym's own verbs, on the registry.
//
// These five were the bar's original hand-built branches — a field on the
// tool schema, a sanitiser, a card kind, a confirm handler and an apply
// path each, spread across the Timeline. Moving them here changes nothing
// an owner sees: the same sanitisers guard them, the same writes run, the
// same two-choice cards ask. What it changes is the cost of the next one.
//
// Each spec fetches what it needs through `ctx` rather than being handed
// it, so a spec is independent of the screen showing it. That costs a
// query per preview and buys the property that matters: an action works
// wherever the registry is dispatched from.

import {
  ActionError,
  argString,
  erase,
  gymTimezone,
  type ActionContext,
  type ActionSpec,
  type AnyAction,
} from './types';
import {
  choicesFromGym,
  GYM_RULES_SELECT,
  type ClassTypeCancelRow,
  type GymRulesRow,
} from '../rules-read';
import { applyPlans, applyRules, applyTimetable } from '../setup-apply';
import {
  formatDays,
  formatPrice,
  ruleChangeLine,
  ruleSentence,
  sanitisePlans,
  sanitiseRuleChanges,
  sanitiseTimetable,
  type PlansProposal,
  type RuleChange,
  type RuleChoices,
  type TimetableProposal,
} from '../setup-flow';
import {
  newsletterDocument,
  sanitiseNewsletter,
  type NewsletterDraft,
} from '../newsletter-draft';
import { describeAudience } from '../email/audience';
import {
  AUDIENCE_ARGS,
  audienceLine,
  brandOf,
  docFor,
  newsletterCard,
  readAudienceArgs,
  type NewsletterAudience,
} from './comms';
import type { Json } from '../../types/database';

// The gym's live settings, read the same way the rule sheet reads them.
async function currentRules(ctx: ActionContext) {
  const [gymRes, typesRes] = await Promise.all([
    ctx.supabase.from('gyms').select(GYM_RULES_SELECT).eq('id', ctx.gymId).single(),
    ctx.supabase
      .from('class_types')
      .select('cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_minutes_before')
      .eq('gym_id', ctx.gymId)
      .is('archived_at', null),
  ]);
  if (gymRes.error || !gymRes.data) {
    throw gymRes.error ?? new Error('Could not read settings');
  }
  const gym = gymRes.data as unknown as GymRulesRow;
  return {
    choices: choicesFromGym(gym, (typesRes.data ?? []) as ClassTypeCancelRow[]),
    defaults: {
      capacity: gym.default_class_capacity,
      minutes: gym.default_class_minutes,
    },
  };
}

// A rule change is only a change relative to what the gym has now, and
// "now" can move between previewing and confirming — so the no-op filter
// runs in both, each reading the live rules for itself. sanitise stays
// pure and judges only the shape.
export const changeRules: ActionSpec<{ changes: RuleChange[] }> = {
  name: 'gym.change_rules',
  kind: 'do',
  // Owner, and no capability. Every setter applyRules calls —
  // set_gym_operating_defaults, set_require_membership_to_book,
  // set_allow_minors, set_gym_weight_unit, set_dm_scope,
  // set_gym_public_signup, set_gym_public_lead_capture — asks
  // user_is_owner_of, and the rule sheet on the Timeline is drawn only
  // for owners. can_edit_classes covers admins and coaches, so this
  // sentence was offered to people the first RPC would refuse.
  capability: null,
  roles: ['owner'],
  says:
    'Change how the gym runs — "free cancel until 2 hours before", "let ' +
    'people book 3 days out", "members can book without a membership", ' +
    '"cancelling is free from 30 minutes before".',
  args: [
    {
      name: 'rule_changes',
      type: 'list',
      desc:
        'The settings they named, as an array of {field, value}. Fields and ' +
        'their values:\n' +
        '       booking_window_hours_ahead: hours as integer ("2 weeks"→336, ' +
        '"5 days"→120), or null for no limit.\n' +
        '       late_cancel: when cancelling starts to cost the credit. ' +
        '"never", or "abs:HH:MM" for a set time the evening before ("9pm the ' +
        'night before"→"abs:21:00", "10pm"→"abs:22:00"), or "rel:N" for N ' +
        'minutes before the class ("2 hours before"→"rel:120", "30 minutes ' +
        'before"→"rel:30"). Any time and any number of minutes are valid — ' +
        'this one is not a fixed menu.\n' +
        '       booking_cutoff_minutes_before: minutes as integer, 0 = up to ' +
        'the start.\n' +
        '       require_membership_to_book / allow_minors / leaderboards_on / ' +
        'public_signup / public_lead_capture / members_can_self_checkout: ' +
        'boolean.\n' +
        '       week_starts_on: "mon" | "sun". weight_unit: "kg" | "lb". ' +
        'dm_scope: "full_gym" | "member_coach_only".\n' +
        '       expiring_within_days / lead_conversion_window_days / ' +
        'parq_expiry_days: days as integer. health_retention_months: months. ' +
        'cover_warning_hours: hours, 0 = off.\n' +
        '       Enum and boolean fields must land on one of the listed values ' +
        'exactly. If the owner names something else — a different time, or a ' +
        'rule that varies by class, day or member — do NOT round to the ' +
        'nearest value: leave that field out and name it in `cannot`. A ' +
        'sentence can do both: take the parts that fit and name the rest.',
      required: true,
    },
  ],
  invalidate: ['gym-rules'],
  sanitise: (raw) => {
    const changes = sanitiseRuleChanges({ changes: raw.rule_changes });
    return changes ? { changes } : null;
  },
  preview: async (a, ctx) => {
    const { choices } = await currentRules(ctx);
    const live = a.changes.filter((c) => choices[c.field] !== c.value);
    if (live.length === 0) {
      return { title: 'Those are already how the gym runs.', lines: [] };
    }
    return {
      title: live.length === 1 ? 'Change this rule?' : 'Change these rules?',
      lines: live.map((c) => ruleChangeLine(c, choices)),
      yes: 'Yes, change it',
    };
  },
  apply: async (a, ctx) => {
    const { choices, defaults } = await currentRules(ctx);
    const live = a.changes.filter((c) => choices[c.field] !== c.value);
    if (live.length === 0) return 'Nothing to change — already set that way.';
    const next = { ...choices } as RuleChoices;
    for (const c of live) {
      (next as Record<string, unknown>)[c.field] = c.value;
    }
    await applyRules(ctx.supabase, ctx.gymId, defaults, next, {
      // Rewriting every class type's cancel policy is only right when the
      // cancel rule itself changed; an unrelated change must not flatten a
      // per-class override somebody set deliberately.
      touchCancelPolicy: live.some((c) => c.field === 'late_cancel'),
    });
    const lines = live.map((c) => ruleSentence(c.field, next));
    return `Done. ${lines.join('. ')}.`;
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Closure = { startsOn: string; endsOn: string; reason: string | null };

export const closeGym: ActionSpec<Closure> = {
  name: 'gym.close_dates',
  kind: 'do',
  // close_gym_dates checks can_bulk_edit_classes, which stops at admin —
  // closing a week cancels every session in it, which is not the same
  // permission as moving one class. The advertised key was the looser
  // can_edit_classes, so a coach was offered the sentence and refused.
  capability: 'can_bulk_edit_classes',
  says:
    'Shut the gym for a stretch of days — "close 24 to 28 December", ' +
    '"we\'re shut next Monday for the bank holiday".',
  args: [
    {
      name: 'starts_on',
      type: 'date',
      desc:
        'First day closed, YYYY-MM-DD, resolved forward from today ("22 Dec" ' +
        'is the next December)',
      required: true,
    },
    { name: 'ends_on', type: 'date', desc: 'Last day closed, YYYY-MM-DD', required: true },
    { name: 'reason', type: 'string', desc: 'Their stated reason, if they gave one' },
  ],
  invalidate: ['class-sessions-month', 'my-upcoming-sessions'],
  sanitise: (raw) => {
    const startsOn = typeof raw.starts_on === 'string' ? raw.starts_on : '';
    const endsOn = typeof raw.ends_on === 'string' ? raw.ends_on : '';
    if (!DATE_RE.test(startsOn) || !DATE_RE.test(endsOn)) return null;
    if (endsOn < startsOn) return null;
    return { startsOn, endsOn, reason: argString(raw, 'reason', 120) };
  },
  preview: async (a) => ({
    title:
      a.startsOn === a.endsOn
        ? `Close the gym on ${closureDay(a.startsOn)}?`
        : `Close the gym ${closureDay(a.startsOn)} to ${closureDay(a.endsOn)}?`,
    lines: [
      'Every class in those dates is cancelled, everyone booked is refunded their credit and told.',
      ...(a.reason ? [`Reason given: ${a.reason}`] : []),
    ],
    yes: 'Yes, close it',
  }),
  apply: async (a, ctx) => {
    const { data, error } = await ctx.supabase.rpc('close_gym_dates', {
      p_gym_id: ctx.gymId,
      p_start: a.startsOn,
      p_end: a.endsOn,
      p_reason: a.reason,
      p_exclude_session_ids: null,
    });
    if (error) throw error;
    const result = data as { cancelled: number; notified: number } | null;
    const range =
      a.startsOn === a.endsOn
        ? `on ${closureDay(a.startsOn)}`
        : `${closureDay(a.startsOn)} to ${closureDay(a.endsOn)}`;
    const cancelled = result?.cancelled ?? 0;
    return cancelled > 0
      ? `The gym is closed ${range}. ${cancelled} ${cancelled === 1 ? 'class' : 'classes'} cancelled — everyone booked has been refunded and told.`
      : `The gym is closed ${range}. Nothing was scheduled in those dates yet.`;
  },
};

function closureDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export const addClasses: ActionSpec<{ proposal: TimetableProposal }> = {
  name: 'gym.add_classes',
  kind: 'do',
  capability: 'can_edit_classes',
  says:
    'Put a NEW class on the timetable — "add a 7am Wednesday spin class, ' +
    'cap 12", "CrossFit at 6 and 7 on weekdays".',
  args: [
    {
      name: 'schedules',
      type: 'list',
      desc:
        'The classes described, as an array of {class_type, days, times, ' +
        'duration_minutes, capacity}. days use 0=Sunday…6=Saturday ' +
        '("weekdays"→[1,2,3,4,5]); times are 24-hour "HH:MM" ("6am"→"06:00"); ' +
        'duration_minutes defaults to 60 and capacity to 16 when unstated.',
      required: true,
    },
  ],
  invalidate: ['class-sessions-month', 'class-types', 'my-upcoming-sessions'],
  sanitise: (raw) => {
    const proposal = sanitiseTimetable({ schedules: raw.schedules });
    return proposal ? { proposal } : null;
  },
  preview: async (a) => ({
    title: 'Add this to the timetable?',
    lines: a.proposal.schedules.map(
      (s) =>
        `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}, ` +
        `${s.duration_minutes} min, cap ${s.capacity}`,
    ),
    yes: 'Yes, add it',
  }),
  apply: async (a, ctx) => {
    // The timetable is the gym's, and so are its hours. Creating a 6am
    // class from a device in Athens put it on the calendar at 4am.
    await applyTimetable(ctx.supabase, ctx.gymId, await gymTimezone(ctx), a.proposal);
    const lines = a.proposal.schedules.map(
      (s) => `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}`,
    );
    return `On the timetable. ${lines.join('. ')}.`;
  },
};

export const addPlans: ActionSpec<{ proposal: PlansProposal }> = {
  name: 'gym.add_plans',
  kind: 'do',
  capability: 'can_manage_plans',
  says:
    'Create a NEW membership plan — "an off-peak membership at £59", ' +
    '"a 10-class pack for £90".',
  args: [
    {
      name: 'plans',
      type: 'list',
      desc:
        'The plans described, as an array of {name, kind, ' +
        'monthly_price_cents, credit_count, notice_period_days, blurb}. kind ' +
        'is "unlimited" | "credit_period" | "credit_pack" | ' +
        '"programming_only". monthly_price_cents is minor units, so the ' +
        'amount they said times 100 ("89"→8900) whatever the currency. N ' +
        'classes a month is credit_period with credit_count N. blurb is a ' +
        'short plain line a member would read, carrying any restriction they ' +
        'stated (student, off-peak).',
      required: true,
    },
  ],
  invalidate: ['membership-plans'],
  sanitise: (raw) => {
    const proposal = sanitisePlans({ plans: raw.plans });
    return proposal ? { proposal } : null;
  },
  preview: async (a, ctx) => ({
    title: 'Create these memberships?',
    lines: a.proposal.plans.map((p) => {
      const credits = p.credit_count !== null ? `, ${p.credit_count} classes` : '';
      const notice =
        p.notice_period_days !== null && p.notice_period_days > 0
          ? `, ${p.notice_period_days} days notice`
          : '';
      return `${p.name} — ${formatPrice(p.monthly_price_cents, ctx.currency)}${credits}${notice}`;
    }),
    yes: 'Yes, create them',
  }),
  apply: async (a, ctx) => {
    try {
      await applyPlans(ctx.supabase, ctx.gymId, a.proposal);
    } catch (e) {
      if (e instanceof Error && /already exists|duplicate/i.test(e.message)) {
        throw new ActionError(
          'One of those plans already exists — nothing was created.',
        );
      }
      throw e;
    }
    const names = a.proposal.plans
      .map((p) => `${p.name} at ${formatPrice(p.monthly_price_cents, ctx.currency)}`)
      .join(', ');
    return `Created. ${names}.`;
  },
};

export const draftNewsletter: ActionSpec<{
  draft: NewsletterDraft;
  audience: NewsletterAudience;
}> = {
  name: 'comms.draft_newsletter',
  kind: 'do',
  capability: 'can_manage_comms',
  says:
    'Write to the members — "send a newsletter, Christmas hours and the ' +
    'new barbell club", "email everyone on the injured tag about the ' +
    'rehab class", "tell the lapsed lot we miss them".',
  args: [
    {
      name: 'newsletter',
      type: 'object',
      desc:
        '{subject, sections: [{heading, body}]} — DRAFT it for them: a short ' +
        'subject line and 2-4 sections, each a heading plus 1-3 sentences of ' +
        'warm, plain British English written from the owner\'s brief. Use ONLY ' +
        'facts they stated — never invent dates, times, prices or names. If ' +
        'the brief only names a topic, introduce the topic and tell members ' +
        'to watch this space or ask at the gym.',
      required: true,
    },
    ...AUDIENCE_ARGS,
  ],
  invalidate: ['comms-campaigns'],
  sanitise: (raw) => {
    const draft = sanitiseNewsletter(raw.newsletter);
    return draft ? { draft, audience: readAudienceArgs(raw) } : null;
  },
  preview: async (a, ctx) => {
    // Who it goes to is the first thing on the card, not a detail: a draft
    // addressed to the wrong people reads exactly like one addressed to the
    // right ones. And the draft itself renders rather than being summarised
    // — whether the wording is any good is the only question the owner
    // actually has, and a truncation cannot answer it.
    const { line } = await audienceLine(a.audience, ctx);
    return {
      title: `Draft this newsletter? — “${a.draft.subject}”`,
      lines: [],
      card: 'email',
      data: await newsletterCard(a.draft, line, ctx),
      yes: 'Yes, draft it',
    };
  },
  apply: async (a, ctx) => {
    // Re-resolved rather than carried from the preview: a tag added or
    // renamed between the card opening and Yes should change who this goes
    // to, and the campaign screen is where they'd find out otherwise.
    const { def } = await audienceLine(a.audience, ctx);
    // The same builder the card rendered with, so the campaign saved is
    // byte-for-byte the email that was on screen.
    const doc = docFor(await brandOf(ctx), a.draft.subject, a.draft.sections);
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
    if (error || !data) throw error ?? new Error('Could not draft');
    ctx.offer?.(
      'Open it to send',
      `/management/communications/${(data as { id: string }).id}`,
    );
    return (
      `Drafted — “${a.draft.subject}”, to ${describeAudience(def).toLowerCase()}. ` +
      `Have a read and send it from there.`
    );
  },
};


// ============================================================================
// gym.reopen
// ============================================================================
//
// The other half of gym.close_dates, and the half that was only ever a
// screen. Closing is a sentence; reopening was a card on Manage with a
// per-session picker, so an owner who shut the gym for a burst pipe and
// then got it fixed had to go and find the screen.
//
// The picker is not replaced, it is bypassed for the common case. Putting
// everything back is what "we're open again" means, and reopen_closure
// with an empty exclusion list is exactly that. A gym reopening but
// wanting three of the forty classes to stay cancelled is a real case and
// a rare one — that keeps the card, and the receipt points at it.

type Reopen = { on: string | null };

type ClosureRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

async function liveClosures(ctx: ActionContext): Promise<ClosureRow[]> {
  const { data } = await ctx.supabase
    .from('gym_closures')
    .select('id, starts_on, ends_on, reason')
    .eq('gym_id', ctx.gymId)
    .is('lifted_at', null)
    .order('starts_on', { ascending: true });
  return (data ?? []) as ClosureRow[];
}

function closureRange(c: ClosureRow): string {
  return c.starts_on === c.ends_on
    ? closureDay(c.starts_on)
    : `${closureDay(c.starts_on)} to ${closureDay(c.ends_on)}`;
}

export const reopenGym: ActionSpec<Reopen> = {
  name: 'gym.reopen',
  kind: 'do',
  capability: 'can_bulk_edit_classes',
  says:
    "Open the gym back up after a closure — \"we're open again\", \"cancel " +
    'the closure\", \"we\'re back open on Monday after all\". Puts the ' +
    'cancelled classes back and tells everyone who was booked.',
  args: [
    {
      name: 'on',
      type: 'date',
      desc:
        'Only if they named which closure, as any date inside it (YYYY-MM-DD). ' +
        'Omit if they just said the gym is open again.',
    },
  ],
  invalidate: ['gym-closures', 'gym-closures-live', 'class-sessions-month'],
  sanitise: (raw) => {
    const on = argString(raw, 'on', 10);
    return { on: on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null };
  },
  preview: async (a, ctx) => {
    const all = await liveClosures(ctx);
    if (all.length === 0) {
      return { title: 'The gym is not closed for anything at the moment.', lines: [] };
    }
    const matching = a.on
      ? all.filter((c) => c.starts_on <= a.on! && c.ends_on >= a.on!)
      : all;
    if (matching.length === 0) {
      return {
        title: `Nothing is closed on ${closureDay(a.on!)}.`,
        lines: all.map((c) => `Closed ${closureRange(c)}${c.reason ? ` — ${c.reason}` : ''}.`),
      };
    }
    // More than one closure open at once is unusual and ambiguous, so it
    // asks rather than guessing at the nearest.
    if (matching.length > 1) {
      return {
        title: 'Which closure is ending?',
        lines: [],
        choices: matching.map((c) => ({
          label: `${closureRange(c)}${c.reason ? ` — ${c.reason}` : ''}`,
          args: { on: c.starts_on },
        })),
      };
    }
    const c = matching[0];
    return {
      title: `Open the gym back up for ${closureRange(c)}?`,
      lines: [
        'Every class that was cancelled for it goes back on the timetable.',
        // Bookings are not restored — the refund already happened and
        // re-booking is the member's own decision. Said out loud because
        // an owner reasonably expects "undo" to mean all of it.
        'People are told the classes are back on, but their bookings are not restored — they book again themselves.',
        ...(c.reason ? [`It was closed for: ${c.reason}.`] : []),
      ],
      yes: 'Yes, open it back up',
    };
  },
  apply: async (a, ctx) => {
    const all = await liveClosures(ctx);
    const matching = a.on
      ? all.filter((c) => c.starts_on <= a.on! && c.ends_on >= a.on!)
      : all;
    if (matching.length !== 1) {
      throw new ActionError('That closure is no longer there.');
    }
    const { data, error } = await ctx.supabase.rpc('reopen_closure', {
      p_closure_id: matching[0].id,
      p_exclude: [],
    });
    if (error) {
      throw new ActionError(
        /not authorised|row-level security|permission/i.test(error.message)
          ? 'You do not have permission to reopen the gym.'
          : "That didn't go through — try again.",
      );
    }
    const r = (data ?? {}) as { restored?: number; notified?: number };
    const n = r.restored ?? 0;
    ctx.offer?.('Open the timetable', '/classes');
    return n > 0
      ? `The gym is open again for ${closureRange(matching[0])}. ${n} ${n === 1 ? 'class is' : 'classes are'} back on — everyone who was booked has been told.`
      : `The gym is open again for ${closureRange(matching[0])}. There was nothing left to put back.`;
  },
};

// ============================================================================
// gym.rename
// ============================================================================
//
// The gym's own name, which shows on every email, the join page and the
// app header. Deliberately NOT the slug: that is the public join URL, and
// changing it breaks every link an owner has already put on Instagram, a
// flyer or a door. The two live on the same card today and only one of
// them is safe to say out loud, so the card says which.

export const renameGym: ActionSpec<{ name: string }> = {
  name: 'gym.rename',
  kind: 'do',
  capability: null,
  // set_gym_name asks user_is_owner_of, and what the gym is called is not
  // a grantable decision.
  roles: ['owner'],
  says:
    'Change what the gym is called — "call us Iron Temple", "rename the ' +
    'gym to Temple Strength". Not the web address, which stays as it is.',
  args: [
    {
      name: 'name',
      type: 'string',
      desc: 'The new name, exactly as they said it',
      required: true,
    },
  ],
  invalidate: ['gym-brand'],
  sanitise: (raw) => {
    const name = argString(raw, 'name', 60);
    return name ? { name } : null;
  },
  preview: async (a, ctx) => {
    const { data } = await ctx.supabase
      .from('gyms')
      .select('name, slug')
      .eq('id', ctx.gymId)
      .maybeSingle();
    const gym = data as { name: string; slug: string } | null;
    if (!gym) return { title: 'I could not read your gym.', lines: [] };
    if (gym.name === a.name) {
      return { title: `You are already called ${a.name}.`, lines: [] };
    }
    return {
      title: `Rename the gym to ${a.name}?`,
      lines: [
        `${gym.name} → ${a.name}, on your emails, your join page and the app.`,
        // The thing an owner does not think of, and the one that would
        // cost them: the URL is a separate field on purpose.
        `Your join link does not change — it stays /${gym.slug}. Change that on the Branding card if you mean to, and anything already pointing at the old one stops working.`,
      ],
      yes: 'Yes, rename it',
    };
  },
  apply: async (a, ctx) => {
    const { error } = await ctx.supabase.rpc('set_gym_name', {
      p_gym_id: ctx.gymId,
      p_name: a.name,
    });
    if (error) {
      throw new ActionError(
        /not authorised|row-level security|permission/i.test(error.message)
          ? 'Only an owner can rename the gym.'
          : "That didn't save — try again.",
      );
    }
    return `You are ${a.name} now.`;
  },
};

export const GYM_ACTIONS: AnyAction[] = [
  erase(changeRules),
  erase(addClasses),
  erase(addPlans),
  erase(closeGym),
  erase(reopenGym),
  erase(renameGym),
  erase(draftNewsletter),
];
