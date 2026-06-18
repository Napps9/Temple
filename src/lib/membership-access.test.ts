import { describe, expect, it } from 'vitest';

import {
  hasUsableMembership,
  type AccessComp,
  type AccessSub,
} from './membership-access';

const NOW = '2026-06-18T12:00:00.000Z';
const FUTURE = '2026-07-01T00:00:00.000Z';
const PAST = '2026-06-01T00:00:00.000Z';

describe('hasUsableMembership', () => {
  it('is false with no subscriptions or comps', () => {
    expect(hasUsableMembership([], [], NOW)).toBe(false);
  });

  it('is true for an active subscription', () => {
    expect(
      hasUsableMembership([{ status: 'active', paid_period_end: null }], [], NOW),
    ).toBe(true);
  });

  it('does not count lapsed, cancelled, pending or paused subscriptions', () => {
    const subs: AccessSub[] = [
      { status: 'lapsed', paid_period_end: null },
      { status: 'cancelled', paid_period_end: null },
      { status: 'pending', paid_period_end: null },
      { status: 'paused', paid_period_end: null },
    ];
    expect(hasUsableMembership(subs, [], NOW)).toBe(false);
  });

  it('honours the paid period for cancel-at-period-end and refunded-retained', () => {
    expect(
      hasUsableMembership(
        [{ status: 'cancelled_at_period_end', paid_period_end: FUTURE }],
        [],
        NOW,
      ),
    ).toBe(true);
    expect(
      hasUsableMembership(
        [{ status: 'cancelled_at_period_end', paid_period_end: PAST }],
        [],
        NOW,
      ),
    ).toBe(false);
    expect(
      hasUsableMembership(
        [{ status: 'refunded_retained', paid_period_end: FUTURE }],
        [],
        NOW,
      ),
    ).toBe(true);
    expect(
      hasUsableMembership(
        [{ status: 'refunded_retained', paid_period_end: PAST }],
        [],
        NOW,
      ),
    ).toBe(false);
  });

  it('counts a live comp grant and ignores expired or revoked ones', () => {
    const live: AccessComp = {
      starts_at: PAST,
      ends_at: FUTURE,
      revoked_at: null,
    };
    const expired: AccessComp = {
      starts_at: '2026-05-01T00:00:00.000Z',
      ends_at: PAST,
      revoked_at: null,
    };
    const revoked: AccessComp = {
      starts_at: PAST,
      ends_at: FUTURE,
      revoked_at: '2026-06-10T00:00:00.000Z',
    };
    expect(hasUsableMembership([], [live], NOW)).toBe(true);
    expect(hasUsableMembership([], [expired], NOW)).toBe(false);
    expect(hasUsableMembership([], [revoked], NOW)).toBe(false);
  });
});
