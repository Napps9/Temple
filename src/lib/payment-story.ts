// The payment story's owner-visible sentences, in one reviewable place —
// the forward-tense counterpart of the nudge story (0247). The Timeline
// says what happened; these say who moves next. Same register as
// src/lib/timeline.ts: one idea per sentence, first person only where
// Temple itself acts, no system vocabulary. Pure module — the screen owns
// the fetching.

import { formatPrice } from '@/lib/setup-flow';

export type OverdueRow = {
  subscription_id: string;
  profile_id: string;
  full_name: string | null;
  plan_name: string | null;
  amount_cents: number | null;
  currency: string | null;
  past_due_since: string;
  payment_failure_count: number;
  next_payment_attempt: string | null;
  last_payment_error: string | null;
  notice_status: string | null;
};

export type AttendanceFacts = {
  lastAttended: string | null;
  nextClass: { startsAt: string; name: string | null } | null;
};

export function firstNameOf(full: string | null): string {
  const trimmed = full?.trim() ?? '';
  if (!trimmed) return 'Someone';
  return trimmed.split(/\s+/)[0];
}

export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function paymentSubLine(row: OverdueRow, fallbackCurrency: string): string {
  const price =
    row.amount_cents !== null
      ? formatPrice(row.amount_cents, row.currency ?? fallbackCurrency)
      : null;
  const failing = `started failing ${dayMonth(row.past_due_since)}`;
  if (price && row.plan_name) {
    return `${price} a month for ${row.plan_name} · ${failing}`;
  }
  if (row.plan_name) return `${row.plan_name} · ${failing}`;
  return `Started failing ${dayMonth(row.past_due_since)}`;
}

const RECENT_MS = 28 * 24 * 60 * 60 * 1000;

function attendedRecently(lastAttended: string | null, now: Date): boolean {
  if (!lastAttended) return false;
  return now.getTime() - new Date(lastAttended).getTime() <= RECENT_MS;
}

export function whyLines(
  row: OverdueRow,
  attendance: AttendanceFacts | null,
  now: Date,
): string[] {
  const lines: string[] = [];

  const n = Math.max(row.payment_failure_count, 1);
  lines.push(
    n === 1
      ? `Stripe has tried the card once, on ${dayMonth(row.past_due_since)}, and been declined.`
      : `Stripe has tried the card ${n} times since ${dayMonth(row.past_due_since)} — every try declined.`,
  );

  if (row.last_payment_error) {
    lines.push(`The last try came back “${row.last_payment_error}”.`);
  }

  lines.push(
    row.next_payment_attempt
      ? `It tries again on ${dayMonth(row.next_payment_attempt)} — after about two weeks of failing it gives up.`
      : 'It has given up — from here, nothing collects this on its own.',
  );

  const first = firstNameOf(row.full_name);
  switch (row.notice_status) {
    case 'sent':
      lines.push(`${first} was emailed when it first failed, with the way to fix it.`);
      break;
    case 'queued':
      lines.push(`The email telling ${first} has not gone out yet.`);
      break;
    case 'failed':
      lines.push(`The email telling ${first} could not be delivered.`);
      break;
    default:
      lines.push(`${first} has not been emailed about it.`);
  }

  if (attendance) {
    const recent = attendedRecently(attendance.lastAttended, now);
    const next = attendance.nextClass;
    if (recent && next) {
      lines.push(
        `Still training — last in on ${dayMonth(attendance.lastAttended!)}, booked again on ${dayMonth(next.startsAt)}.`,
      );
    } else if (recent) {
      lines.push(
        `Still training — last in on ${dayMonth(attendance.lastAttended!)}, nothing booked ahead.`,
      );
    } else if (next) {
      lines.push(`Not been in lately, but booked for ${dayMonth(next.startsAt)}.`);
    } else if (attendance.lastAttended) {
      lines.push(
        `Not been in since ${dayMonth(attendance.lastAttended)}, and nothing booked.`,
      );
    }
  }

  return lines;
}

export function whatIdDoLines(
  row: OverdueRow,
  attendance: AttendanceFacts | null,
  jobOn: boolean,
  chased: boolean,
  now: Date,
): string[] {
  if (chased) {
    return ["I'm on it — my nudge is on its way, and the receipt lands in the Timeline."];
  }

  const first = firstNameOf(row.full_name);
  const stillTraining =
    attendance !== null &&
    (attendance.nextClass !== null || attendedRecently(attendance.lastAttended, now));

  if (row.next_payment_attempt === null) {
    return [
      stillTraining
        ? `Reach out today — ${first} is still training here, so this reads like a dead card rather than a goodbye.`
        : `Reach out today — ${first} has not been in lately, so a personal note means more than a template here.`,
      jobOn
        ? "Hand it to me and the nudge below goes out. If nothing lands in a few days, I'll ask you before offering the smaller plan."
        : 'Nobody is chasing these for you yet — taking the job on below sorts that.',
    ];
  }

  return [
    `You could let Stripe try again on ${dayMonth(row.next_payment_attempt)} — a card that just expired often comes right on its own.`,
    jobOn
      ? `Or hand it to me now and ${first} gets the nudge below today, instead of after my three-day wait.`
      : `Or message ${first} yourself — a word from you beats a bank retry.`,
  ];
}

export function nextStepLine(
  row: Pick<OverdueRow, 'next_payment_attempt' | 'full_name'>,
  jobOn: boolean,
  chased: boolean,
): string {
  if (chased) return "I'm on it — my nudge is on its way, and the receipt lands here.";
  const retry = row.next_payment_attempt;
  if (retry) {
    return jobOn
      ? `Stripe tries again on ${dayMonth(retry)} — or hand it to me and the nudge goes today.`
      : `Stripe tries again on ${dayMonth(retry)} — nobody else is on it yet.`;
  }
  return (
    'Stripe has given up — nothing happens on its own now. This one needs you' +
    (jobOn ? ' or me.' : '.')
  );
}

export const PAYMENT_QUESTIONS = [
  'What happens if I do nothing?',
  'Have they been told?',
  'Why might the card be failing?',
];

export const PAYMENT_ASK_PLACEHOLDER =
  'Ask about this — what happens if I wait, what they owe…';
