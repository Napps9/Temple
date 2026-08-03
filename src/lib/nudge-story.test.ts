import { describe, expect, it } from 'vitest';

import {
  decisionLine,
  evidenceLines,
  messageStatusLine,
  outcomeLine,
  recipientName,
  type StoryAction,
  type StoryMessage,
} from './nudge-story';

function action(partial: Partial<StoryAction>): StoryAction {
  return {
    action_kind: 'chase_message',
    status: 'executed',
    payload: { member_name: 'Emma Wilson' },
    evidence: ['Payment failed twice.', 'Still training here.'],
    proposed_at: '2026-07-29T09:41:00Z',
    decided_by: null,
    decided_at: null,
    ...partial,
  };
}

function msg(partial: Partial<StoryMessage>): StoryMessage {
  return {
    recipient_profile_id: 'p1',
    subject: 'About your payment',
    body: 'Hi Emma — …',
    status: 'sent',
    error: null,
    sent_at: '2026-07-29T10:02:00Z',
    ...partial,
  };
}

describe('decisionLine', () => {
  it('says who said yes, and when', () => {
    expect(
      decisionLine(
        action({ decided_by: 'u1', decided_at: '2026-07-29T10:00:00Z' }),
        'Nick Apps',
        true,
      ),
    ).toBe('You said yes on 29/07/2026.');
    expect(
      decisionLine(
        action({ decided_by: 'u2', decided_at: '2026-07-29T10:00:00Z' }),
        'Dana Cole',
        false,
      ),
    ).toBe('Dana Cole said yes on 29/07/2026.');
  });

  it('owns the standing go-ahead rather than inventing a decider', () => {
    expect(decisionLine(action({ decided_by: null }), null, false)).toBe(
      'Sent without asking — you gave this job the go-ahead to act on its own.',
    );
  });

  it('keeps a no and a lapse distinct — both ended with nothing sent', () => {
    expect(
      decisionLine(
        action({ status: 'rejected', decided_by: 'u1', decided_at: '2026-07-30T08:00:00Z' }),
        null,
        true,
      ),
    ).toBe('You said no on 30/07/2026 — nothing was sent.');
    expect(decisionLine(action({ status: 'expired' }), null, false)).toBe(
      'Nobody answered before it lapsed — nothing was sent.',
    );
  });

  it('says a proposed one is waiting, not done', () => {
    expect(decisionLine(action({ status: 'proposed' }), null, false)).toBe(
      'Waiting on you — nothing goes out until you say yes.',
    );
  });
});

describe('messageStatusLine', () => {
  it('stamps a sent message with its moment', () => {
    const line = messageStatusLine(msg({}));
    expect(line.tone).toBe('neutral');
    // The clock half follows the machine's timezone, so pin the shape
    // rather than the hour.
    expect(line.text).toMatch(/^Sent 29\/07\/2026 at \d{1,2}:\d{2}(am|pm)\.$/);
  });

  it('explains the queue instead of looking stuck', () => {
    expect(messageStatusLine(msg({ status: 'queued', sent_at: null })).text).toBe(
      'Waiting to go — these send between 9am and 8pm, gym time.',
    );
  });

  it('marks the ways a message can not arrive, in plain words', () => {
    expect(
      messageStatusLine(msg({ status: 'failed', sent_at: null })),
    ).toEqual({ text: "It didn't send — it will be tried again.", tone: 'amber' });
    expect(
      messageStatusLine(
        msg({ status: 'skipped', sent_at: null, error: 'No email address' }),
      ).text,
    ).toBe('Not sent — they have no email address.');
    expect(
      messageStatusLine(
        msg({
          status: 'skipped',
          sent_at: null,
          error:
            'That address bounced or was marked as spam — held back from every send',
        }),
      ).text,
    ).toBe('Not sent — their address bounces, so nothing is mailed to it.');
  });
});

describe('recipientName', () => {
  it('names the member from the payload', () => {
    expect(recipientName(msg({}), { member_name: 'Emma Wilson' })).toBe(
      'Emma Wilson',
    );
  });

  it('finds a fan-out recipient in the list, not the headline name', () => {
    const payload = {
      class_label: 'Tuesday 6am CrossFit',
      recipients: [
        { profile_id: 'p1', name: 'Ivan Evans' },
        { profile_id: 'p2', name: 'Jess Foster' },
      ],
    };
    expect(recipientName(msg({ recipient_profile_id: 'p2' }), payload)).toBe(
      'Jess Foster',
    );
  });

  it('has an honest floor for an erased profile', () => {
    expect(recipientName(msg({}), {})).toBe('A member');
  });
});

describe('outcomeLine', () => {
  it('says nothing for the kinds that have no case to report on', () => {
    expect(outcomeLine(null)).toBeNull();
  });

  it('reports a closed case by what actually happened', () => {
    expect(
      outcomeLine({ stage: 'closed', outcome: 'recovered', closed_at: '2026-08-01' }),
    ).toBe('Their payment went through — sorted on 01/08/2026.');
    expect(outcomeLine({ stage: 'closed', outcome: 'left', closed_at: null })).toBe(
      'They left the gym.',
    );
  });

  it('keeps watching out loud while the case is open', () => {
    expect(outcomeLine({ stage: 'watching', outcome: null, closed_at: null })).toBe(
      "I'm still watching their payment.",
    );
    expect(
      outcomeLine({ stage: 'offer_pending', outcome: null, closed_at: null }),
    ).toBe('The offer is out — their call now.');
  });
});

describe('evidenceLines', () => {
  it('keeps only real sentences', () => {
    expect(
      evidenceLines(action({ evidence: ['A line.', 42, '', null, 'Another.'] })),
    ).toEqual(['A line.', 'Another.']);
    expect(evidenceLines(action({ evidence: null }))).toEqual([]);
  });
});
