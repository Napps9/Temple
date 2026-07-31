import { describe, expect, it } from 'vitest';

import {
  sendReport,
  unreachableLabel,
  unreachableNote,
  type SendStats,
} from './comms-report';

function stats(partial: Partial<SendStats>): SendStats {
  return {
    recipients: 0,
    sent: 0,
    delivered: 0,
    successful: 0,
    simulated: 0,
    failed: 0,
    bounced: 0,
    complained: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
    skipped: 0,
    tracked: false,
    ...partial,
  };
}

describe('how a send went', () => {
  it('states what arrived when it knows, and only what left when it does not', () => {
    const measured = sendReport(
      'Christmas hours',
      stats({ recipients: 214, sent: 214, delivered: 208, successful: 208, tracked: true }),
    );
    expect(measured.title).toBe('“Christmas hours”: 214 sent, 208 arrived.');

    const unmeasured = sendReport(
      'Christmas hours',
      stats({ recipients: 214, sent: 214, tracked: false }),
    );
    expect(unmeasured.title).toBe('“Christmas hours”: 214 sent.');
    expect(unmeasured.lines).toContain(
      'No delivery reports came back for this one, so I can tell you what went out and not how much of it arrived.',
    );
  });

  // A send where 100 of 214 bounced has a 50% open rate among the people
  // it reached and a 23% one among the people it was aimed at. The second
  // number blames the writing for a bad address list.
  it('reads engagement against what arrived, not against what left', () => {
    const line = sendReport(
      'Christmas hours',
      stats({
        sent: 214,
        successful: 114,
        opened: 57,
        clicked: 12,
        bounced: 100,
        tracked: true,
      }),
    ).lines[0];
    expect(line).toBe('57 opened it (50%) and 12 clicked through (11%).');
  });

  it('falls back to what left when nothing came back', () => {
    const line = sendReport(
      'Christmas hours',
      stats({ sent: 200, opened: 50, clicked: 10, tracked: false }),
    ).lines[0];
    expect(line).toBe('50 opened it (25%) and 10 clicked through (5%).');
  });

  it('says what was done about the bounces rather than only counting them', () => {
    const lines = sendReport(
      'Christmas hours',
      stats({ sent: 214, successful: 208, bounced: 6, tracked: true }),
    ).lines;
    expect(lines).toContain(
      '6 bounced — those addresses are held back from future sends.',
    );
  });

  it('does not bury a spam complaint', () => {
    const lines = sendReport(
      'Christmas hours',
      stats({ sent: 40, successful: 39, complained: 1, tracked: true }),
    ).lines;
    expect(lines).toContain('1 person marked it as spam.');
  });

  it('calls a simulated send what it was', () => {
    const r = sendReport('Christmas hours', stats({ sent: 12, simulated: 12 }));
    expect(r.title).toBe('“Christmas hours” was a practice run.');
  });

  it('does not dress up a send that reached nobody', () => {
    const r = sendReport('Christmas hours', stats({ recipients: 8, sent: 0, failed: 8 }));
    expect(r.title).toBe('“Christmas hours” reached nobody.');
    expect(r.lines).toEqual(['All 8 were refused before they left.']);
  });
});

// A bounce and a spam complaint both mean "stop emailing this person" and
// want opposite advice from a coach: one is usually a typo worth fixing,
// the other is a decision worth respecting.
describe('a member we cannot email', () => {
  it('labels the two reasons differently', () => {
    expect(unreachableLabel('hard_bounce')).toBe('Email dead');
    expect(unreachableLabel('complaint')).toBe('Marked spam');
  });

  it('tells a coach what to do instead, by first name', () => {
    const bounce = unreachableNote('hard_bounce', 'Marcus Webb');
    expect(bounce).toContain('Marcus');
    expect(bounce).not.toContain('Webb');
    expect(bounce).toMatch(/Phone them or message them in Temple/);
    expect(bounce).toMatch(/typo/);
  });

  it('does not suggest undoing a spam complaint', () => {
    const spam = unreachableNote('complaint', 'Marcus Webb');
    expect(spam).toMatch(/worth leaving alone/);
    expect(spam).not.toMatch(/typo/);
  });

  it('copes with a member who has no name on file', () => {
    expect(unreachableNote('hard_bounce', '   ')).toMatch(/^Email to This member/);
  });
});
