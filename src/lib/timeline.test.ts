import { describe, expect, it } from 'vitest';

import {
  dayLabel,
  formatTimelineLine,
  groupTimelineByDay,
  type TimelineEvent,
} from './timeline';

function evt(partial: Partial<TimelineEvent>): TimelineEvent {
  return {
    item_id: 'x:1',
    kind: 'member_joined',
    occurred_at: '2026-07-29T09:41:00Z',
    subject: 'Sarah Jones',
    detail: {},
    ...partial,
  };
}

describe('formatTimelineLine', () => {
  it('reads joins as one plain sentence', () => {
    expect(formatTimelineLine(evt({}))).toEqual({
      text: 'Sarah Jones joined.',
      tone: 'neutral',
    });
  });

  it('speaks first-person only when Temple itself acted', () => {
    const ai = formatTimelineLine(
      evt({
        kind: 'lead_captured',
        subject: 'Kelly Brown',
        detail: { source: 'AI front desk', status: 'cold' },
      }),
    );
    expect(ai.text).toBe("Kelly Brown got in touch — I've taken their details.");

    const manual = formatTimelineLine(
      evt({
        kind: 'lead_captured',
        subject: 'Kelly Brown',
        detail: { source: 'Walk-in', status: 'cold' },
      }),
    );
    expect(manual.text).toBe('Kelly Brown asked about joining, through Walk-in.');
  });

  it('marks live problems amber and keeps system vocabulary out', () => {
    const retrying = formatTimelineLine(
      evt({
        kind: 'payment_failing',
        subject: 'Emma Wilson',
        detail: { plan_name: 'Unlimited', next_payment_attempt: '2026-08-01T00:00:00Z' },
      }),
    );
    expect(retrying.tone).toBe('amber');
    expect(retrying.text).toBe(
      "Emma's payment didn't go through — the card will be tried again.",
    );
    // No dunning/subscription/retry-count vocabulary anywhere owner-visible.
    expect(retrying.text.toLowerCase()).not.toMatch(/dunning|subscription|stripe/);

    const givenUp = formatTimelineLine(
      evt({
        kind: 'payment_failing',
        subject: 'Emma Wilson',
        detail: { plan_name: 'Unlimited', next_payment_attempt: null },
      }),
    );
    expect(givenUp.text).toBe(
      "Emma's payment didn't go through, and no more tries are coming.",
    );
  });

  it('phrases cover in people, not requests', () => {
    expect(
      formatTimelineLine(
        evt({
          kind: 'cover_requested',
          subject: 'Sam Cole',
          detail: { class_count: 3, status: 'open' },
        }),
      ).text,
    ).toBe('Sam asked for cover on 3 classes.');
    expect(
      formatTimelineLine(
        evt({
          kind: 'cover_claimed',
          subject: 'Jess Field',
          detail: { covered_for: 'Sam Cole' },
        }),
      ).text,
    ).toBe('Jess is covering for Sam.');
  });

  it('renders membership requests as an amber question subject', () => {
    const cancel = formatTimelineLine(
      evt({
        kind: 'membership_request',
        subject: 'Marcus Reid',
        detail: { request_kind: 'cancel', request_id: 'r1', current_plan: 'Unlimited' },
      }),
    );
    expect(cancel).toEqual({
      text: 'Marcus wants to cancel their membership.',
      tone: 'amber',
    });

    const move = formatTimelineLine(
      evt({
        kind: 'membership_request',
        subject: 'Marcus Reid',
        detail: { request_kind: 'switch_plan', request_id: 'r1', target_plan: '8-class pack' },
      }),
    );
    expect(move.text).toBe('Marcus wants to move to 8-class pack.');
  });

  it('speaks the money loop in questions and receipts, never system words', () => {
    const proposed = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Emma Wilson',
        detail: {
          action_kind: 'chase_message',
          status: 'proposed',
          payload: { member_name: 'Emma Wilson', plan_name: 'Unlimited' },
        },
      }),
    );
    expect(proposed).toEqual({
      text: 'Send Emma a nudge about their payment?',
      tone: 'amber',
    });

    const offered = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Marcus Reid',
        detail: {
          action_kind: 'plan_adjustment_offer',
          status: 'executed',
          payload: {
            member_name: 'Marcus Reid',
            offer_plan_name: 'Basic',
            offer_price: '£59',
          },
        },
      }),
    );
    expect(offered.text).toBe("I've offered Marcus Basic at £59 — their call now.");
    expect(offered.text.toLowerCase()).not.toMatch(/case|dunning|proposal|subscription/);

    const rejected = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Emma Wilson',
        detail: {
          action_kind: 'chase_message',
          status: 'rejected',
          payload: { member_name: 'Emma Wilson' },
        },
      }),
    );
    expect(rejected.text).toBe("Emma's payment — you said leave it, so I did.");
  });

  // The fourth job's own voice. Gone quiet and never started are different
  // facts about different people, and a card that says "we've missed you"
  // to somebody who has never been in reads as a mistake.
  it('asks about somebody who joined and never came', () => {
    const proposed = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Priya Shah',
        detail: {
          action_kind: 'first_week_message',
          status: 'proposed',
          payload: { member_name: 'Priya Shah', days_since_join: 14 },
        },
      }),
    );
    expect(proposed).toEqual({
      text: "Priya joined 14 days ago and hasn't been in yet — say something?",
      tone: 'amber',
    });

    const sent = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Priya Shah',
        detail: {
          action_kind: 'first_week_message',
          status: 'executed',
          payload: { member_name: 'Priya Shah', days_since_join: 14 },
        },
      }),
    );
    expect(sent.text).toBe("I've offered Priya a hand getting started.");

    // No day count is still a sentence, not a gap.
    const noDays = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Priya Shah',
        detail: {
          action_kind: 'first_week_message',
          status: 'proposed',
          payload: { member_name: 'Priya Shah' },
        },
      }),
    );
    expect(noDays.text).toBe("Priya joined and hasn't been in yet — say something?");
  });

  // The fifth job. One class left has to read as "1 class"; the count is
  // the whole content of the line, so a plural bug is the sentence.
  it('counts the classes left on a pack', () => {
    const two = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Sam Doyle',
        detail: {
          action_kind: 'credits_low_message',
          status: 'proposed',
          payload: { member_name: 'Sam Doyle', credits_left: 2 },
        },
      }),
    );
    expect(two).toEqual({
      text: 'Sam is down to 2 classes — give them the heads up?',
      tone: 'amber',
    });

    const one = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Sam Doyle',
        detail: {
          action_kind: 'credits_low_message',
          status: 'proposed',
          payload: { member_name: 'Sam Doyle', credits_left: 1 },
        },
      }),
    );
    expect(one.text).toBe('Sam is down to 1 class — give them the heads up?');

    const sent = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: 'Sam Doyle',
        detail: {
          action_kind: 'credits_low_message',
          status: 'executed',
          payload: { member_name: 'Sam Doyle', credits_left: 1 },
        },
      }),
    );
    expect(sent.text).toBe("I've let Sam know their pack is nearly out.");
  });

  it('describes closures with their dates', () => {
    const line = formatTimelineLine(
      evt({
        kind: 'gym_closed',
        subject: '',
        detail: { starts_on: '2026-12-22', ends_on: '2027-01-03', lifted: false },
      }),
    );
    expect(line.text).toBe(
      'The gym is closed from 22 Dec to 3 Jan — everyone booked has been told.',
    );
  });
});

// The receipt an owner gets when a send finishes (0229). The distinction
// the copy has to hold: a send whose delivery reports never arrived must
// not claim a number, and a send whose reports are still arriving must
// not imply the rest failed.
describe('the receipt for a send', () => {
  function campaign(detail: Record<string, unknown>) {
    return formatTimelineLine(
      evt({ kind: 'campaign_sent', subject: 'Christmas hours', detail }),
    );
  }

  it('says how many it went to, and stops there when nothing came back', () => {
    const line = campaign({
      status: 'sent',
      tracked: false,
      sent: 214,
      successful: 0,
      bounced: 0,
      complained: 0,
    });
    expect(line.text).toBe('“Christmas hours” went to 214 members.');
    expect(line.tone).toBe('neutral');
  });

  it('adds what arrived without implying the rest did not', () => {
    expect(
      campaign({
        status: 'sent',
        tracked: true,
        sent: 214,
        successful: 208,
        bounced: 0,
        complained: 0,
      }).text,
    ).toBe('“Christmas hours” went to 214 members, and 208 arrived.');
  });

  it('names the bounces and says what was done about them', () => {
    const line = campaign({
      status: 'sent',
      tracked: true,
      sent: 214,
      successful: 208,
      bounced: 6,
      complained: 0,
    });
    expect(line.text).toBe(
      '“Christmas hours” went to 214 members, and 208 arrived. 6 addresses bounced — I’ve stopped mailing them.',
    );
    expect(line.tone).toBe('amber');
  });

  it('does not hide a spam complaint', () => {
    const line = campaign({
      status: 'sent',
      tracked: true,
      sent: 40,
      successful: 39,
      bounced: 0,
      complained: 1,
    });
    expect(line.text).toBe(
      '“Christmas hours” went to 40 members, and 39 arrived. Someone marked it as spam.',
    );
    expect(line.tone).toBe('amber');
  });

  it('tells the truth about a practice run and a stopped send', () => {
    expect(
      campaign({ status: 'sent', tracked: false, sent: 12, simulated: 12 }).text,
    ).toBe('“Christmas hours” was a practice run — nothing actually left the building.');
    expect(
      campaign({ status: 'cancelled', tracked: true, sent: 42, skipped: 158 }).text,
    ).toBe('I stopped “Christmas hours” — 42 had already gone, 158 didn’t.');
    expect(campaign({ status: 'failed', sent: 0 }).text).toBe(
      '“Christmas hours” didn’t go out — nobody received it.',
    );
  });
});

describe('groupTimelineByDay', () => {
  const now = new Date(2026, 6, 29, 12, 0, 0); // 29 Jul 2026, local

  it('groups by local day, oldest day first, oldest event first within a day', () => {
    const groups = groupTimelineByDay(
      [
        evt({ item_id: 'c', occurred_at: new Date(2026, 6, 29, 9, 0).toISOString() }),
        evt({ item_id: 'a', occurred_at: new Date(2026, 6, 28, 18, 0).toISOString() }),
        evt({ item_id: 'b', occurred_at: new Date(2026, 6, 29, 7, 0).toISOString() }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Yesterday', 'Today']);
    expect(groups[1].events.map((e) => e.item_id)).toEqual(['b', 'c']);
  });

  it('labels older days with the weekday and date', () => {
    expect(dayLabel('2026-07-20', now)).toBe('Monday 20 Jul');
    expect(dayLabel('2025-12-24', now)).toBe('Wednesday 24 Dec 2025');
  });
});
