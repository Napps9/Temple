// The story behind one nudge line (0247): what Temple noticed, who
// decided, the exact words that went out, and what came of it. Every
// owner-visible sentence lives here, pure and unit-tested, in the same
// register as src/lib/timeline.ts — one idea per line, first person only
// where Temple itself acted, no system vocabulary. The screen
// (src/app/(staff)/timeline/[action].tsx) reads the rows under RLS and
// hands them straight to these.

import { formatDate } from './format-date';
import { formatClock } from './timeline';

export type StoryAction = {
  action_kind: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'expired';
  payload: Record<string, unknown> | null;
  evidence: unknown;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type StoryMessage = {
  recipient_profile_id: string | null;
  subject: string;
  body: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  sent_at: string | null;
};

export type StoryCase = {
  stage: 'watching' | 'touch_2_sent' | 'offer_pending' | 'closed';
  outcome: 'recovered' | 'adjusted' | 'lapsed' | 'left' | null;
  closed_at: string | null;
};

export function evidenceLines(action: StoryAction): string[] {
  return Array.isArray(action.evidence)
    ? (action.evidence as unknown[]).filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      )
    : [];
}

// Who said yes, in words. `deciderName` is null while the profile is
// still loading or when nobody decided; the copy must hold either way.
export function decisionLine(
  action: StoryAction,
  deciderName: string | null,
  viewerDecided: boolean,
): string {
  const who = viewerDecided ? 'You' : deciderName ?? 'Somebody on the team';
  const when = action.decided_at ? ` on ${formatDate(action.decided_at)}` : '';
  switch (action.status) {
    case 'proposed':
      return 'Waiting on you — nothing goes out until you say yes.';
    case 'rejected':
      return `${who} said no${when} — nothing was sent.`;
    case 'expired':
      return 'Nobody answered before it lapsed — nothing was sent.';
    default:
      // approved / executed. No decided_by means the job has the standing
      // go-ahead, which is itself a decision the owner made once.
      return action.decided_by
        ? `${who} said yes${when}.`
        : 'Sent without asking — you gave this job the go-ahead to act on its own.';
  }
}

export type MessageStatusLine = { text: string; tone: 'neutral' | 'amber' };

export function messageStatusLine(msg: StoryMessage): MessageStatusLine {
  switch (msg.status) {
    case 'sent':
      return {
        text: msg.sent_at
          ? `Sent ${formatDate(msg.sent_at)} at ${formatClock(msg.sent_at)}.`
          : 'Sent.',
        tone: 'neutral',
      };
    case 'queued':
      return {
        text: 'Waiting to go — these send between 9am and 8pm, gym time.',
        tone: 'neutral',
      };
    case 'failed':
      return { text: "It didn't send — it will be tried again.", tone: 'amber' };
    case 'skipped': {
      if (msg.error && msg.error.startsWith('No email')) {
        return { text: 'Not sent — they have no email address.', tone: 'amber' };
      }
      if (msg.error && /bounced|spam/i.test(msg.error)) {
        return {
          text: 'Not sent — their address bounces, so nothing is mailed to it.',
          tone: 'amber',
        };
      }
      return { text: 'Not sent.', tone: 'amber' };
    }
  }
}

// The class-return fan-out names its recipients in the payload; every
// other kind is about one member. 'A member' is the honest floor when a
// profile has been erased since.
export function recipientName(
  msg: StoryMessage,
  payload: Record<string, unknown> | null,
): string {
  const listed = Array.isArray(payload?.recipients)
    ? (payload.recipients as { profile_id?: unknown; name?: unknown }[]).find(
        (r) =>
          typeof r?.profile_id === 'string' &&
          r.profile_id === msg.recipient_profile_id,
      )
    : undefined;
  if (listed && typeof listed.name === 'string' && listed.name) return listed.name;
  const member = payload?.member_name;
  if (typeof member === 'string' && member) return member;
  return 'A member';
}

// Only the payment kinds open a case; for the rest this stays null and
// the screen says nothing — a retention note has no "since then" the
// database could honestly report.
export function outcomeLine(c: StoryCase | null): string | null {
  if (!c) return null;
  if (c.stage === 'closed') {
    switch (c.outcome) {
      case 'recovered':
        return `Their payment went through — sorted${c.closed_at ? ` on ${formatDate(c.closed_at)}` : ''}.`;
      case 'adjusted':
        return 'They took the offer and moved plan.';
      case 'lapsed':
        return 'The payment never recovered, and the membership lapsed.';
      case 'left':
        return 'They left the gym.';
      default:
        return null;
    }
  }
  if (c.stage === 'offer_pending') return 'The offer is out — their call now.';
  return "I'm still watching their payment.";
}
