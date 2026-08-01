import { describe, expect, it } from 'vitest';

import { campaignReport, RATE_AT, type CampaignStats } from './campaign-report';

function stats(over: Partial<CampaignStats> = {}): CampaignStats {
  return {
    recipients: 86,
    sent: 86,
    successful: 84,
    simulated: 0,
    failed: 0,
    skipped: 0,
    bounced: 0,
    complained: 0,
    opened: 41,
    clicked: 9,
    unsubscribed: 0,
    tracked: true,
    ...over,
  };
}

describe('campaignReport', () => {
  it('leads with what arrived, as a count', () => {
    const r = campaignReport(stats());
    expect(r.hero).toEqual({
      value: '84',
      label: 'arrived',
      detail: 'of 86 sent · 98%',
    });
  });

  // The bug this module exists for: at one recipient "100%" is not a
  // rate, it is a way of spelling "1".
  it('does not turn one recipient into a percentage', () => {
    const r = campaignReport(stats({ recipients: 1, sent: 1, successful: 1, opened: 1, clicked: 0 }));
    expect(r.hero.value).toBe('1');
    expect(r.hero.detail).toBe('of 1 sent');
    expect(r.hero.detail).not.toContain('%');
    expect(r.tiles[0]).toEqual({
      label: 'Opened',
      value: '1',
      detail: 'of 1 arrived',
      tone: 'default',
    });
  });

  it('starts showing a rate once the denominator can carry one', () => {
    const under = campaignReport(stats({ recipients: 9, sent: 9, successful: 9, opened: 3 }));
    expect(under.tiles[0].detail).toBe('of 9 arrived');

    const at = campaignReport(stats({ recipients: RATE_AT, sent: RATE_AT, successful: RATE_AT, opened: 3 }));
    expect(at.tiles[0].detail).toBe('of 10 arrived · 30%');
  });

  it('reads opens against what arrived, not what left', () => {
    // 100 sent, 50 arrived, 25 opened. Against what left that is 25%,
    // which counts fifty bad addresses as people who ignored you.
    const r = campaignReport(stats({ recipients: 100, sent: 100, successful: 50, opened: 25 }));
    expect(r.tiles[0].detail).toBe('of 50 arrived · 50%');
  });

  it('says nothing about the things that did not happen', () => {
    const r = campaignReport(stats());
    expect(r.tiles.map((t) => t.label)).toEqual(['Opened', 'Clicked']);
  });

  it('and says plenty about the things that did', () => {
    const r = campaignReport(
      stats({
        recipients: 92,
        sent: 86,
        bounced: 2,
        complained: 1,
        unsubscribed: 3,
        failed: 4,
        skipped: 2,
      }),
    );
    expect(r.tiles.map((t) => t.label)).toEqual([
      'Opened',
      'Clicked',
      'Bounced',
      'Marked as spam',
      'Unsubscribed',
      'Never sent',
      'Held back',
    ]);
    for (const label of ['Bounced', 'Marked as spam', 'Unsubscribed', 'Never sent']) {
      expect(r.tiles.find((t) => t.label === label)?.tone).toBe('red');
    }
    // Stopping a send is a feature, not a failure, so it is not red.
    expect(r.tiles.find((t) => t.label === 'Held back')?.tone).toBe('muted');
  });

  // recipients - sent is failed + skipped + whatever is still in flight,
  // so a tile derived from it would count the same person twice beside
  // the explicit ones.
  it('never derives a count from the gap between recipients and sent', () => {
    const r = campaignReport(stats({ recipients: 92, sent: 86, failed: 4, skipped: 2 }));
    expect(r.tiles.find((t) => t.label === 'Never sent')?.value).toBe('4');
    expect(r.tiles.find((t) => t.label === 'Held back')?.value).toBe('2');
    expect(r.tiles.some((t) => t.value === '6')).toBe(false);
  });

  // An unmeasured zero and a real zero are different facts, so the
  // untracked case never prints a number it does not have.
  it('does not pretend to know what arrived when nothing came back', () => {
    const r = campaignReport(stats({ tracked: false, successful: 0 }));
    expect(r.hero.value).toBe('86');
    expect(r.hero.label).toBe('emails sent');
    expect(r.hero.detail).toBe('Whether they arrived is not being measured.');
    // Opens still work — the pixel does not depend on the webhook — but
    // they read against what left, because that is all that is known.
    expect(r.tiles[0].detail).toBe('of 86 sent · 48%');
  });

  it('says a test send was a test send, and stops', () => {
    const r = campaignReport(stats({ sent: 3, simulated: 3, successful: 0, opened: 0, clicked: 0 }));
    expect(r.hero.value).toBe('3');
    expect(r.hero.label).toBe('test sends');
    expect(r.hero.detail).toContain('no email provider');
    expect(r.tiles).toEqual([]);
  });

  it('gets its singulars right, since one is the common case in a new gym', () => {
    const one = campaignReport(stats({ recipients: 1, sent: 1, simulated: 1, successful: 0 }));
    expect(one.hero.label).toBe('test send');

    const untracked = campaignReport(stats({ recipients: 1, sent: 1, tracked: false }));
    expect(untracked.hero.label).toBe('email sent');
  });

  it('never divides by zero', () => {
    const r = campaignReport(
      stats({ recipients: 0, sent: 0, successful: 0, opened: 0, clicked: 0 }),
    );
    expect(r.hero.value).toBe('0');
    expect(r.tiles[0].detail).toBe('of 0 sent');
  });
});
