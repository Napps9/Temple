// The Timeline's read-only feed (0204): one chronological stream per gym,
// unioned server-side from what already happens. The RPC returns typed
// rows; every owner-visible sentence is written here, in one place, so the
// register ("How Temple talks" — docs/loop-1-payment-recovery.md) is
// reviewable: one idea per message, first person only where Temple itself
// acted, no system vocabulary. Pure module — the fetch hook lives with the
// screen, because anything importing supabase.ts can't be parsed by vitest.

export type TimelineKind =
  | 'member_joined'
  | 'lead_captured'
  | 'payment_failing'
  | 'held_back'
  | 'cover_requested'
  | 'cover_claimed'
  | 'gym_closed'
  | 'membership_request'
  | 'campaign_sent'
  | 'agent_action';

export type TimelineEvent = {
  item_id: string;
  kind: TimelineKind;
  occurred_at: string;
  subject: string;
  detail: Record<string, unknown>;
};

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return 'Someone';
  return trimmed.split(/\s+/)[0];
}

function str(detail: Record<string, unknown>, key: string): string | null {
  const v = detail[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const AI_SOURCE = 'ai front desk';

export type TimelineLine = {
  text: string;
  // amber marks the lines that describe a live problem; everything else is
  // a quiet receipt.
  tone: 'neutral' | 'amber';
};

export function formatTimelineLine(e: TimelineEvent): TimelineLine {
  switch (e.kind) {
    case 'member_joined':
      return { text: `${e.subject.trim() || 'A new member'} joined.`, tone: 'neutral' };
    case 'lead_captured': {
      const name = e.subject.trim() || 'Someone';
      const source = str(e.detail, 'source');
      if (source && source.trim().toLowerCase() === AI_SOURCE) {
        return { text: `${name} got in touch — I've taken their details.`, tone: 'neutral' };
      }
      return {
        text: source
          ? `${name} asked about joining, through ${source}.`
          : `${name} asked about joining.`,
        tone: 'neutral',
      };
    }
    case 'payment_failing': {
      const name = firstName(e.subject);
      const retry = str(e.detail, 'next_payment_attempt');
      return {
        text: retry
          ? `${name}'s payment didn't go through — the card will be tried again.`
          : `${name}'s payment didn't go through, and no more tries are coming.`,
        tone: 'amber',
      };
    }
    case 'cover_requested': {
      const count = typeof e.detail.class_count === 'number' ? e.detail.class_count : 0;
      const name = firstName(e.subject);
      const classes = count === 1 ? 'a class' : `${count} classes`;
      return { text: `${name} asked for cover on ${classes}.`, tone: 'neutral' };
    }
    case 'cover_claimed': {
      const coveredFor = str(e.detail, 'covered_for');
      const name = firstName(e.subject);
      return {
        text: coveredFor
          ? `${name} is covering for ${firstName(coveredFor)}.`
          : `${name} picked up a cover class.`,
        tone: 'neutral',
      };
    }
    case 'gym_closed': {
      const from = str(e.detail, 'starts_on');
      const to = str(e.detail, 'ends_on');
      const range =
        from && to
          ? from === to
            ? ` on ${formatDay(from)}`
            : ` from ${formatDay(from)} to ${formatDay(to)}`
          : '';
      return { text: `The gym is closed${range} — everyone booked has been told.`, tone: 'neutral' };
    }
    case 'membership_request': {
      const name = firstName(e.subject);
      const kind = str(e.detail, 'request_kind');
      if (kind === 'cancel') {
        return { text: `${name} wants to cancel their membership.`, tone: 'amber' };
      }
      const target = str(e.detail, 'target_plan');
      return {
        text: target
          ? `${name} wants to move to ${target}.`
          : `${name} wants to change their membership.`,
        tone: 'amber',
      };
    }
    case 'held_back': {
      const n = num(e.detail, 'held');
      // The budget's own voice. Without it a quiet Timeline reads as a
      // product with nothing to say rather than one being careful, and
      // those are opposite things to believe about your gym.
      return {
        text:
          n === 1
            ? "There was one more worth mentioning today — I'll bring it tomorrow."
            : `There were ${n} more worth mentioning today — I'll bring them tomorrow.`,
        tone: 'neutral',
      };
    }
    case 'campaign_sent':
      return campaignSentLine(e);
    case 'agent_action':
      return agentActionLine(e);
  }
}

function num(detail: Record<string, unknown>, key: string): number {
  const v = detail[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function people(n: number): string {
  return n === 1 ? '1 member' : `${n} members`;
}

// The receipt for a send (0229). Read at scroll time rather than written
// at send time, because the interesting half of what happened to an email
// — whether it arrived — lands minutes to hours after the last one goes
// out. The counts here are recomputed on every read, so a line that said
// "went to 214" this morning can say "and 211 arrived" this afternoon.
function campaignSentLine(e: TimelineEvent): TimelineLine {
  const title = e.subject.trim() || 'A campaign';
  const status = str(e.detail, 'status');
  const sent = num(e.detail, 'sent');
  const bounced = num(e.detail, 'bounced');
  const complained = num(e.detail, 'complained');

  if (status === 'failed') {
    return { text: `“${title}” didn’t go out — nobody received it.`, tone: 'amber' };
  }
  if (status === 'cancelled') {
    const skipped = num(e.detail, 'skipped');
    return {
      text: `I stopped “${title}” — ${sent} had already gone, ${skipped} didn’t.`,
      tone: 'neutral',
    };
  }
  if (sent > 0 && num(e.detail, 'simulated') === sent) {
    return {
      text: `“${title}” was a practice run — nothing actually left the building.`,
      tone: 'neutral',
    };
  }

  // "and N arrived" rather than "N of M", which would read as a claim
  // that the rest failed. While the reports are still coming in, they
  // haven't.
  const arrived =
    e.detail.tracked === true && num(e.detail, 'successful') > 0
      ? `, and ${num(e.detail, 'successful')} arrived`
      : '';
  let text = `“${title}” went to ${people(sent)}${arrived}.`;
  if (bounced > 0) {
    text += ` ${bounced === 1 ? 'One address' : `${bounced} addresses`} bounced — I’ve stopped mailing ${bounced === 1 ? 'it' : 'them'}.`;
  }
  if (complained > 0) {
    text += ` ${complained === 1 ? 'Someone' : `${complained} people`} marked it as spam.`;
  }
  return { text, tone: bounced > 0 || complained > 0 ? 'amber' : 'neutral' };
}

// The money loop's receipts and questions (0206). Payload fields are
// SQL-derived (agent_revenue_tick), never model-authored, so the copy
// here is the whole owner-visible vocabulary of the loop.
function agentActionLine(e: TimelineEvent): TimelineLine {
  const payload = (e.detail.payload ?? {}) as Record<string, unknown>;
  const status = str(e.detail, 'status');
  const kind = str(e.detail, 'action_kind');
  const memberName =
    typeof payload.member_name === 'string' && payload.member_name
      ? payload.member_name
      : e.subject;
  const first = firstName(memberName);
  const offerPlan =
    typeof payload.offer_plan_name === 'string' ? payload.offer_plan_name : null;
  const offerPrice =
    typeof payload.offer_price === 'string' ? payload.offer_price : null;
  const isOffer = kind === 'plan_adjustment_offer';

  if (kind === 'retention_message') {
    const weeks =
      typeof payload.weeks_absent === 'number' ? payload.weeks_absent : null;
    switch (status) {
      case 'proposed':
        return {
          text: weeks
            ? `Reach out to ${first}? They've not been in for ${weeks} week${weeks === 1 ? '' : 's'}.`
            : `Reach out to ${first}? They've gone quiet.`,
          tone: 'amber',
        };
      case 'approved':
      case 'executed':
        return {
          text: `I've dropped ${first} a note — we've missed them.`,
          tone: 'neutral',
        };
      case 'rejected':
        return { text: `${first} — you said leave it, so I did.`, tone: 'neutral' };
      default:
        return {
          text: `The question about ${first} lapsed — nothing was sent.`,
          tone: 'neutral',
        };
    }
  }

  if (kind === 'first_week_message') {
    const days =
      typeof payload.days_since_join === 'number' ? payload.days_since_join : null;
    switch (status) {
      case 'proposed':
        return {
          text: days
            ? `${first} joined ${days} days ago and hasn't been in yet — say something?`
            : `${first} joined and hasn't been in yet — say something?`,
          tone: 'amber',
        };
      case 'approved':
      case 'executed':
        return {
          text: `I've offered ${first} a hand getting started.`,
          tone: 'neutral',
        };
      case 'rejected':
        return { text: `${first} — you said leave it, so I did.`, tone: 'neutral' };
      default:
        return {
          text: `The question about ${first} lapsed — nothing was sent.`,
          tone: 'neutral',
        };
    }
  }

  if (kind === 'credits_low_message') {
    const left =
      typeof payload.credits_left === 'number' ? payload.credits_left : null;
    const phrase =
      left === null
        ? 'their last few classes'
        : `${left} class${left === 1 ? '' : 'es'}`;
    switch (status) {
      case 'proposed':
        return {
          text: `${first} is down to ${phrase} — give them the heads up?`,
          tone: 'amber',
        };
      case 'approved':
      case 'executed':
        return {
          text: `I've let ${first} know their pack is nearly out.`,
          tone: 'neutral',
        };
      case 'rejected':
        return { text: `${first} — you said leave it, so I did.`, tone: 'neutral' };
      default:
        return {
          text: `The question about ${first} lapsed — nothing was sent.`,
          tone: 'neutral',
        };
    }
  }

  if (kind === 'plan_upgrade_offer') {
    const saving =
      typeof payload.upgrade_saving === 'string' ? payload.upgrade_saving : null;
    const plan =
      typeof payload.offer_plan_name === 'string' ? payload.offer_plan_name : null;
    switch (status) {
      case 'proposed':
        return {
          text: saving
            ? `${first} is paying over the odds — ${plan ?? 'a membership'} would save them ${saving} a month. Tell them?`
            : `${first} would be better off on ${plan ?? 'a membership'} — tell them?`,
          tone: 'amber',
        };
      case 'approved':
      case 'executed':
        return {
          text: `I've shown ${first} the sums — ${plan ?? 'the membership'} is theirs to take.`,
          tone: 'neutral',
        };
      case 'rejected':
        return { text: `${first} — you said leave it, so I did.`, tone: 'neutral' };
      default:
        return {
          text: `The question about ${first} lapsed — nothing was sent.`,
          tone: 'neutral',
        };
    }
  }

  if (kind === 'cover_ask') {
    const requester = str(payload as Record<string, unknown>, 'requester_name');
    const who = requester ? firstName(requester) : 'a coach';
    switch (status) {
      case 'proposed':
        return {
          text: `${who === 'a coach' ? 'A class' : `${who}'s class`} is still uncovered — ask the coaches again?`,
          tone: 'amber',
        };
      case 'approved':
      case 'executed':
        return {
          text: `Asked — every coach who could take ${who === 'a coach' ? 'it' : `${who}'s class`} has a fresh nudge.`,
          tone: 'neutral',
        };
      case 'rejected':
        return { text: `The cover ask — you said leave it, so I did.`, tone: 'neutral' };
      default:
        return { text: `The cover ask lapsed — nothing was sent.`, tone: 'neutral' };
    }
  }

  switch (status) {
    case 'proposed':
      return {
        text: isOffer
          ? `Offer ${first} the smaller plan?`
          : `Send ${first} a nudge about their payment?`,
        tone: 'amber',
      };
    case 'approved':
    case 'executed':
      return {
        text: isOffer
          ? `I've offered ${first} ${offerPlan ?? 'the smaller plan'}${offerPrice ? ` at ${offerPrice}` : ''} — their call now.`
          : `I've nudged ${first} about their payment — they have the link.`,
        tone: 'neutral',
      };
    case 'rejected':
      return {
        text: `${first}'s payment — you said leave it, so I did.`,
        tone: 'neutral',
      };
    case 'expired':
      return {
        text: `The question about ${first}'s payment lapsed — nothing was sent.`,
        tone: 'neutral',
      };
    default:
      return { text: `I've been looking after ${first}'s payment.`, tone: 'neutral' };
  }
}

// "3 Jan" — for closure windows, which are dates, not timestamps.
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, '')
    .toLowerCase();
}

export type TimelineDayGroup = {
  key: string;
  label: string;
  // Oldest first inside a day — the stream reads downward like a
  // conversation.
  events: TimelineEvent[];
};

function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(key: string, now: Date): string {
  const todayKey = localDayKey(now);
  if (key === todayKey) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDayKey(yesterday)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const withYear = y !== now.getFullYear();
  // Composed by hand: en-GB only inserts a comma when a year is present,
  // and the labels should read the same shape all the way down the stream.
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
  return `${weekday} ${day}`;
}

// Feed arrives newest-first from the RPC; the screen reads oldest-at-top
// like a conversation, so groups come back oldest day first.
export function groupTimelineByDay(
  events: TimelineEvent[],
  now: Date = new Date(),
): TimelineDayGroup[] {
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = localDayKey(new Date(e.occurred_at));
    const list = byDay.get(key);
    if (list) list.push(e);
    else byDay.set(key, [e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, list]) => ({
      key,
      label: dayLabel(key, now),
      events: [...list].sort((a, b) =>
        a.occurred_at < b.occurred_at ? -1 : 1,
      ),
    }));
}
