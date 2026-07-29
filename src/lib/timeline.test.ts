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
