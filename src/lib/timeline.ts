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
  | 'cover_requested'
  | 'cover_claimed'
  | 'gym_closed'
  | 'membership_request'
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
    case 'agent_action': {
      // Placeholder until the first loop writes real payloads; the loop-1
      // build owns the per-kind copy.
      const name = e.subject.trim();
      return {
        text: name ? `I've been looking after ${firstName(name)}'s payment.` : 'I took care of something.',
        tone: 'neutral',
      };
    }
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
