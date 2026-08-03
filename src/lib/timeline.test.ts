import { describe, expect, it } from 'vitest';

import {
  dayLabel,
  dedupeClosures,
  formatTimelineLine,
  groupTimelineByDay,
  splitTimeline,
  storyHref,
  stripeWarning,
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
  it('reads joins as one plain sentence, with the name to scan by', () => {
    expect(formatTimelineLine(evt({}))).toEqual({
      text: 'Sarah Jones joined.',
      tone: 'neutral',
      lead: 'Sarah Jones',
    });
  });

  // The lead is a rendering contract: always a prefix of the text, so the
  // screen can bold it by slicing rather than re-deriving the name.
  it('only ever offers a lead that prefixes its own text', () => {
    const kinds: TimelineEvent[] = [
      evt({}),
      evt({ kind: 'lead_captured', detail: { source: 'Walk-in' } }),
      evt({ kind: 'payment_failing', detail: {} }),
      evt({ kind: 'cover_requested', detail: { class_count: 2 } }),
      evt({ kind: 'cover_claimed', detail: {} }),
      evt({ kind: 'membership_request', detail: { request_kind: 'cancel' } }),
      evt({ kind: 'campaign_sent', detail: { status: 'sent', sent: 3 } }),
    ];
    for (const e of kinds) {
      const line = formatTimelineLine(e);
      expect(line.lead).toBeTruthy();
      expect(line.text.startsWith(line.lead!)).toBe(true);
    }
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
    // Stripe giving up is not "still a problem", it is money stopped —
    // one rung above amber.
    expect(givenUp.tone).toBe('red');
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
      lead: 'Marcus',
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

  // The seventh job, and the first line about a class rather than a
  // person. Everything above it reads `member_name` and falls back to
  // e.subject; this one has neither, and getting that wrong puts an
  // empty name in the middle of the sentence.
  it('talks about the class, not about anybody', () => {
    const proposed = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: '',
        detail: {
          action_kind: 'class_return_message',
          status: 'proposed',
          payload: {
            class_label: 'Tuesday 6am CrossFit',
            eligible: 6,
            recipients: [1, 2, 3, 4, 5, 6],
          },
        },
      }),
    );
    expect(proposed).toEqual({
      text:
        'Tuesday 6am CrossFit is emptying — 6 regulars have stopped coming, ' +
        'and they are all still training here. Ask them back?',
      tone: 'amber',
    });

    const one = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: '',
        detail: {
          action_kind: 'class_return_message',
          status: 'proposed',
          payload: { class_label: 'Friday 7:30pm Yoga', eligible: 1 },
        },
      }),
    );
    expect(one.text).toBe(
      'Friday 7:30pm Yoga is emptying — one regular has stopped coming, and ' +
      'they are still training here. Ask them back?',
    );

    const sent = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: '',
        detail: {
          action_kind: 'class_return_message',
          status: 'executed',
          payload: {
            class_label: 'Tuesday 6am CrossFit',
            eligible: 6,
            recipients: [1, 2, 3, 4, 5, 6],
          },
        },
      }),
    );
    expect(sent.text).toBe(
      "I've asked the 6 regulars back to Tuesday 6am CrossFit.",
    );

    const declined = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: '',
        detail: {
          action_kind: 'class_return_message',
          status: 'rejected',
          payload: { class_label: 'Tuesday 6am CrossFit', eligible: 6 },
        },
      }),
    );
    expect(declined.text).toBe(
      'Tuesday 6am CrossFit — you said leave it, so I did.',
    );
  });

  // Past twelve the tick caps the send, so the receipt has to say what
  // went out and not what qualified — "I've asked the 30 regulars back"
  // when 12 were emailed is the owner's record of a thing that did not
  // happen.
  it('reports what was sent, not what qualified', () => {
    const capped = formatTimelineLine(
      evt({
        kind: 'agent_action',
        subject: '',
        detail: {
          action_kind: 'class_return_message',
          status: 'executed',
          payload: {
            class_label: 'Monday 6am CrossFit',
            eligible: 30,
            recipients: new Array(12).fill(0),
          },
        },
      }),
    );
    expect(capped.text).toBe(
      "I've asked the 12 regulars back to Monday 6am CrossFit.",
    );
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

// A line's claim and its receipt (0247). The nudge lines open the story
// page, a campaign opens its report, a join opens the member — and the
// lines with nothing more to show open nowhere.
describe('storyHref', () => {
  it('sends a nudge line to its own story', () => {
    expect(
      storyHref(
        evt({
          item_id: 'action:8b6f7c2a-0000-4000-8000-000000000001',
          kind: 'agent_action',
          detail: { action_kind: 'chase_message', status: 'executed', payload: {} },
        }),
      ),
    ).toBe('/timeline/8b6f7c2a-0000-4000-8000-000000000001');
  });

  it('sends a campaign line to the report that already exists', () => {
    expect(
      storyHref(
        evt({
          kind: 'campaign_sent',
          detail: { campaign_id: 'c1', status: 'sent', sent: 3 },
        }),
      ),
    ).toBe('/management/communications/c1');
  });

  it('sends a join and a failing payment to the member', () => {
    expect(storyHref(evt({ detail: { profile_id: 'p1' } }))).toBe(
      '/management/members/p1',
    );
    expect(
      storyHref(evt({ kind: 'payment_failing', detail: { profile_id: 'p2' } })),
    ).toBe('/management/members/p2');
  });

  it('opens nowhere when there is nothing more to show', () => {
    // A join from before 0247 has no profile id — a dead tap would be a
    // broken promise, so the row stays a plain line.
    expect(storyHref(evt({ detail: {} }))).toBeNull();
    expect(storyHref(evt({ kind: 'gym_closed', detail: {} }))).toBeNull();
    expect(storyHref(evt({ kind: 'held_back', detail: { held: 2 } }))).toBeNull();
  });
});

// The screen's one glanceable promise: the stream is the record, the
// block is the work. Nothing that needs a decision may hide in the
// stream, and nothing already settled may nag from the block.
describe('splitTimeline', () => {
  const proposed = evt({
    item_id: 'action:a1',
    kind: 'agent_action',
    detail: { action_kind: 'chase_message', status: 'proposed', payload: {} },
  });
  const executed = evt({
    item_id: 'action:a2',
    kind: 'agent_action',
    detail: { action_kind: 'chase_message', status: 'executed', payload: {} },
  });
  const request = evt({
    item_id: 'mcr:r1',
    kind: 'membership_request',
    detail: { request_kind: 'cancel', request_id: 'r1' },
  });
  const failing = evt({
    item_id: 'dunning:d1',
    kind: 'payment_failing',
    detail: { profile_id: 'p1' },
  });
  const joined = evt({ item_id: 'member:m1' });

  it('pulls the questions and live problems out of the stream', () => {
    const { stream, waiting } = splitTimeline([
      proposed,
      executed,
      request,
      failing,
      joined,
    ]);
    expect(waiting.map((e) => e.item_id)).toEqual([
      'dunning:d1',
      'mcr:r1',
      'action:a1',
    ]);
    expect(stream.map((e) => e.item_id)).toEqual(['action:a2', 'member:m1']);
  });

  it('offers a cover claim only to somebody who can take it', () => {
    const cover = (requestedBy: string) =>
      evt({
        item_id: 'coverreq:c1',
        kind: 'cover_requested',
        detail: {
          class_count: 1,
          requested_by: requestedBy,
          open_sessions: [{ offer_id: 'o1', name: 'Yoga', starts_at: 'x' }],
        },
      });
    // Somebody else's ask, offers open: work.
    expect(splitTimeline([cover('u2')], 'u1').waiting).toHaveLength(1);
    // Your own ask is not a thing you can claim.
    expect(splitTimeline([cover('u1')], 'u1').waiting).toHaveLength(0);
    // Nothing left to claim: just the record of the ask.
    const claimed = evt({
      item_id: 'coverreq:c2',
      kind: 'cover_requested',
      detail: { class_count: 1, requested_by: 'u2', open_sessions: [] },
    });
    expect(splitTimeline([claimed], 'u1').waiting).toHaveLength(0);
  });

  it('reads the block oldest-first, so the longest wait comes first', () => {
    const older = { ...proposed, item_id: 'action:old', occurred_at: '2026-07-28T09:00:00Z' };
    const newer = { ...request, item_id: 'mcr:new', occurred_at: '2026-07-29T09:00:00Z' };
    // Feed order is newest-first.
    const { waiting } = splitTimeline([newer, older]);
    expect(waiting.map((e) => e.item_id)).toEqual(['action:old', 'mcr:new']);
  });
});

describe('dedupeClosures', () => {
  it('says a closure once, however many times it was written', () => {
    const closure = (id: string) =>
      evt({
        item_id: `closure:${id}`,
        kind: 'gym_closed',
        detail: { starts_on: '2026-12-25', ends_on: '2026-12-25', lifted: false },
      });
    const other = evt({
      item_id: 'closure:other',
      kind: 'gym_closed',
      detail: { starts_on: '2026-12-31', ends_on: '2027-01-01', lifted: false },
    });
    const out = dedupeClosures([closure('a'), closure('b'), other, closure('c'), joinedEvt()]);
    expect(out.map((e) => e.item_id)).toEqual([
      'closure:a',
      'closure:other',
      'member:j1',
    ]);
  });

  function joinedEvt() {
    return evt({ item_id: 'member:j1' });
  }

  it('keeps a lifted closure distinct from a live one', () => {
    const live = evt({
      item_id: 'closure:live',
      kind: 'gym_closed',
      detail: { starts_on: '2026-12-25', ends_on: '2026-12-25', lifted: false },
    });
    const lifted = evt({
      item_id: 'closure:lifted',
      kind: 'gym_closed',
      detail: { starts_on: '2026-12-25', ends_on: '2026-12-25', lifted: true },
    });
    expect(dedupeClosures([live, lifted])).toHaveLength(2);
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

describe('stripeWarning', () => {
  const HEALTHY = {
    connected: true as const,
    reachable: true as const,
    chargesEnabled: true,
    payoutsEnabled: true,
  };

  it('says nothing when payments work, because a working processor is not news', () => {
    expect(stripeWarning(HEALTHY)).toBeNull();
  });

  it('says nothing to a gym that has never connected Stripe', () => {
    // That fact belongs to the go-live checklist, and one problem in two
    // voices reads as two problems.
    expect(stripeWarning({ connected: false })).toBeNull();
  });

  it('says nothing when the check itself could not run', () => {
    expect(stripeWarning(undefined)).toBeNull();
  });

  it('is red when Stripe cannot be reached, because every payment is failing', () => {
    const w = stripeWarning({ connected: true, reachable: false });
    expect(w?.tone).toBe('red');
    expect(w?.text).toContain('cannot reach');
    expect(w?.text).toContain('shop');
  });

  it('is amber when onboarding was never finished, and says nobody can pay', () => {
    const w = stripeWarning({ ...HEALTHY, chargesEnabled: false });
    expect(w?.tone).toBe('amber');
    expect(w?.text).toContain('Nobody can pay you');
  });

  it('mentions held payouts, which nothing else in Temple would', () => {
    const w = stripeWarning({ ...HEALTHY, payoutsEnabled: false });
    expect(w?.tone).toBe('amber');
    expect(w?.text).toContain('not reaching your bank');
  });

  it('leads with charges when both charges and payouts are off', () => {
    // Held payouts are irrelevant to a gym that cannot take money at all,
    // and two lines about Stripe on one screen is one too many.
    const w = stripeWarning({
      ...HEALTHY,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    expect(w?.text).toContain('will not take payments yet');
  });
});
