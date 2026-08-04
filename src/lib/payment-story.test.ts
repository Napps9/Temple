import { describe, expect, it } from 'vitest';

import {
  PAYMENT_ASK_PLACEHOLDER,
  PAYMENT_QUESTIONS,
  nextStepLine,
  paymentSubLine,
  whatIdDoLines,
  splitWaitingByChase,
  whyLines,
  type AttendanceFacts,
  type OverdueRow,
} from './payment-story';
import type { TimelineEvent } from './timeline';

const now = new Date('2026-08-04T12:00:00Z');

function row(partial: Partial<OverdueRow> = {}): OverdueRow {
  return {
    subscription_id: 'sub-1',
    profile_id: 'p1',
    full_name: 'Emma Wilson',
    plan_name: 'Unlimited',
    amount_cents: 8900,
    currency: 'GBP',
    past_due_since: '2026-07-22T09:00:00Z',
    payment_failure_count: 3,
    next_payment_attempt: null,
    last_payment_error: null,
    notice_status: null,
    ...partial,
  };
}

describe('paymentSubLine', () => {
  it('leads with the money when it has both price and plan', () => {
    expect(paymentSubLine(row(), 'USD')).toBe(
      '£89 a month for Unlimited · started failing 22 Jul',
    );
  });

  it('falls back to the plan alone, then to the date alone', () => {
    expect(paymentSubLine(row({ amount_cents: null }), 'GBP')).toBe(
      'Unlimited · started failing 22 Jul',
    );
    expect(
      paymentSubLine(row({ amount_cents: null, plan_name: null }), 'GBP'),
    ).toBe('Started failing 22 Jul');
  });

  it('uses the gym currency when the row carries none', () => {
    expect(paymentSubLine(row({ currency: null }), 'EUR')).toContain('€89');
  });
});

describe('whyLines', () => {
  it('tells the whole story in order: tries, error, what comes next, the email', () => {
    const lines = whyLines(
      row({
        payment_failure_count: 3,
        last_payment_error: 'Your card has expired.',
        next_payment_attempt: '2026-08-05T09:00:00Z',
        notice_status: 'sent',
      }),
      null,
      now,
    );
    expect(lines).toEqual([
      'Stripe has tried the card 3 times since 22 Jul — every try declined.',
      'The last try came back “Your card has expired.”.',
      'It tries again on 5 Aug — after about two weeks of failing it gives up.',
      'Emma was emailed when it first failed, with the way to fix it.',
    ]);
  });

  it('speaks of one try singularly, and treats a zero count as one', () => {
    const single =
      'Stripe has tried the card once, on 22 Jul, and been declined.';
    expect(whyLines(row({ payment_failure_count: 1 }), null, now)[0]).toBe(single);
    expect(whyLines(row({ payment_failure_count: 0 }), null, now)[0]).toBe(single);
  });

  it('skips the error line when Stripe gave no reason', () => {
    const lines = whyLines(row({ last_payment_error: null }), null, now);
    expect(lines.some((l) => l.includes('came back'))).toBe(false);
  });

  it('says plainly when the retries have run out', () => {
    expect(whyLines(row({ next_payment_attempt: null }), null, now)[1]).toBe(
      'It has given up — from here, nothing collects this on its own.',
    );
  });

  it('covers every state the email can be in', () => {
    const emailLine = (notice_status: string | null) =>
      whyLines(row({ notice_status }), null, now).at(-1);
    expect(emailLine('sent')).toBe(
      'Emma was emailed when it first failed, with the way to fix it.',
    );
    expect(emailLine('queued')).toBe('The email telling Emma has not gone out yet.');
    expect(emailLine('failed')).toBe(
      'The email telling Emma could not be delivered.',
    );
    expect(emailLine(null)).toBe('Emma has not been emailed about it.');
    expect(emailLine('something_else')).toBe('Emma has not been emailed about it.');
  });

  // The attendance line is the one that changes what the owner does — a
  // dead card on somebody still training is a different job to a quiet
  // goodbye.
  it('reads attendance four ways, and stays silent with nothing to say', () => {
    const last = (attendance: AttendanceFacts) =>
      whyLines(row(), attendance, now).at(-1);
    expect(
      last({
        lastAttended: '2026-07-30T09:00:00Z',
        nextClass: { startsAt: '2026-08-06T18:00:00Z', name: 'Yoga' },
      }),
    ).toBe('Still training — last in on 30 Jul, booked again on 6 Aug.');
    expect(last({ lastAttended: '2026-07-30T09:00:00Z', nextClass: null })).toBe(
      'Still training — last in on 30 Jul, nothing booked ahead.',
    );
    expect(
      last({
        lastAttended: '2026-06-20T09:00:00Z',
        nextClass: { startsAt: '2026-08-06T18:00:00Z', name: null },
      }),
    ).toBe('Not been in lately, but booked for 6 Aug.');
    expect(last({ lastAttended: '2026-06-20T09:00:00Z', nextClass: null })).toBe(
      'Not been in since 20 Jun, and nothing booked.',
    );
    // Never attended, nothing booked: no line at all.
    expect(
      whyLines(row(), { lastAttended: null, nextClass: null }, now),
    ).toHaveLength(whyLines(row(), null, now).length);
  });
});

describe('whatIdDoLines', () => {
  const stillTraining: AttendanceFacts = {
    lastAttended: '2026-07-30T09:00:00Z',
    nextClass: null,
  };
  const gone: AttendanceFacts = {
    lastAttended: '2026-06-20T09:00:00Z',
    nextClass: null,
  };

  it('says only one thing once the nudge is moving', () => {
    expect(whatIdDoLines(row(), stillTraining, true, true, now)).toEqual([
      "I'm on it — my nudge is on its way, and the receipt lands in the Timeline.",
    ]);
    expect(whatIdDoLines(row(), null, false, true, now)).toEqual([
      "I'm on it — my nudge is on its way, and the receipt lands in the Timeline.",
    ]);
  });

  it('urges reaching out when Stripe has given up', () => {
    expect(whatIdDoLines(row(), stillTraining, true, false, now)).toEqual([
      'Reach out today — Emma is still training here, so this reads like a dead card rather than a goodbye.',
      "Hand it to me and the nudge below goes out. I'll ask you before offering the smaller plan.",
    ]);
    expect(whatIdDoLines(row(), gone, false, false, now)).toEqual([
      'Reach out today — Emma has not been in lately, so a personal note means more than a template here.',
      'Nobody is chasing these for you yet — taking the job on below sorts that.',
    ]);
  });

  it('counts a booking ahead as still training, whatever the last visit was', () => {
    const booked: AttendanceFacts = {
      lastAttended: null,
      nextClass: { startsAt: '2026-08-06T18:00:00Z', name: null },
    };
    expect(whatIdDoLines(row(), booked, true, false, now)[0]).toContain(
      'still training here',
    );
    expect(whatIdDoLines(row(), null, true, false, now)[0]).toContain(
      'has not been in lately',
    );
  });

  it('offers the wait when a retry is coming', () => {
    const amber = row({ next_payment_attempt: '2026-08-05T09:00:00Z' });
    expect(whatIdDoLines(amber, null, true, false, now)).toEqual([
      'You could let Stripe try again on 5 Aug — a card that just expired often comes right on its own.',
      'Or hand it to me now and Emma gets the nudge below — otherwise I pick it up on day three.',
    ]);
    expect(whatIdDoLines(amber, null, false, false, now)).toEqual([
      'You could let Stripe try again on 5 Aug — a card that just expired often comes right on its own.',
      'Or message Emma yourself — a word from you beats a bank retry.',
    ]);
  });
});

describe('nextStepLine', () => {
  const red = row();
  const amber = row({ next_payment_attempt: '2026-08-05T09:00:00Z' });

  it('claims the work once the nudge is moving, whatever else is true', () => {
    expect(nextStepLine(amber, true, true)).toBe(
      "I'm on it — my nudge is on its way.",
    );
    expect(nextStepLine(red, false, true)).toBe(
      "I'm on it — my nudge is on its way.",
    );
  });

  it('names the retry date, and who else could move first', () => {
    expect(nextStepLine(amber, true, false)).toBe(
      'Stripe tries again on 5 Aug — or hand it to me and the nudge goes out.',
    );
    expect(nextStepLine(amber, false, false)).toBe(
      'Stripe tries again on 5 Aug — nobody else is on it yet.',
    );
  });

  it('puts the given-up card squarely on the owner', () => {
    expect(nextStepLine(red, true, false)).toBe(
      'Stripe has given up — nothing happens on its own now. This one needs you or me.',
    );
    expect(nextStepLine(red, false, false)).toBe(
      'Stripe has given up — nothing happens on its own now. This one needs you.',
    );
  });
});

// The register check: Stripe may be named in staff money copy, but the
// system's own vocabulary never leaks into a sentence an owner reads.
describe('how the payment story talks', () => {
  it('never uses system vocabulary in any line it can produce', () => {
    const attendances: (AttendanceFacts | null)[] = [
      null,
      { lastAttended: '2026-07-30T09:00:00Z', nextClass: null },
      {
        lastAttended: '2026-06-20T09:00:00Z',
        nextClass: { startsAt: '2026-08-06T18:00:00Z', name: null },
      },
    ];
    const rows = [
      row(),
      row({
        next_payment_attempt: '2026-08-05T09:00:00Z',
        last_payment_error: 'Insufficient funds.',
        notice_status: 'sent',
      }),
      row({ full_name: null, plan_name: null, amount_cents: null, notice_status: 'queued' }),
    ];
    const lines: string[] = [PAYMENT_ASK_PLACEHOLDER, ...PAYMENT_QUESTIONS];
    for (const r of rows) {
      lines.push(paymentSubLine(r, 'GBP'));
      for (const jobOn of [true, false]) {
        for (const chased of [true, false]) {
          lines.push(nextStepLine(r, jobOn, chased));
        }
      }
      for (const a of attendances) {
        lines.push(...whyLines(r, a, now));
        for (const jobOn of [true, false]) {
          for (const chased of [true, false]) {
            lines.push(...whatIdDoLines(r, a, jobOn, chased, now));
          }
        }
      }
    }
    for (const line of lines) {
      expect(line).not.toMatch(/dunning|subscription|record\b/i);
    }
  });
});

describe('splitWaitingByChase', () => {
  const evt = (
    item_id: string,
    kind: TimelineEvent['kind'],
  ): TimelineEvent => ({
    item_id,
    kind,
    occurred_at: '2026-08-04T09:00:00Z',
    subject: 'Emma Wilson',
    detail: {},
  });

  it('moves only chased payment lines, keeping order on both sides', () => {
    const waiting = [
      evt('dunning:s1', 'payment_failing'),
      evt('mcr:r1', 'membership_request'),
      evt('dunning:s2', 'payment_failing'),
    ];
    const { waiting: still, withMe } = splitWaitingByChase(
      waiting,
      new Set(['s2']),
    );
    expect(still.map((e) => e.item_id)).toEqual(['dunning:s1', 'mcr:r1']);
    expect(withMe.map((e) => e.item_id)).toEqual(['dunning:s2']);
  });

  it('touches nothing when nothing has been chased', () => {
    const waiting = [evt('dunning:s1', 'payment_failing')];
    const { waiting: still, withMe } = splitWaitingByChase(waiting, new Set());
    expect(still).toHaveLength(1);
    expect(withMe).toHaveLength(0);
  });

  // A request naming the same id is not a payment — the split reads the
  // kind, never just the id.
  it('never moves a non-payment line, whatever its id says', () => {
    const waiting = [evt('mcr:s1', 'membership_request')];
    const { withMe } = splitWaitingByChase(waiting, new Set(['s1']));
    expect(withMe).toHaveLength(0);
  });
});
