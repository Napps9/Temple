import { describe, expect, it } from 'vitest';

import { mapMembershipSubStatus } from '../../supabase/functions/_shared/subscription-status';

describe('mapMembershipSubStatus', () => {
  it('maps a failing renewal to past_due', () => {
    expect(mapMembershipSubStatus('past_due', 'active')).toBe('past_due');
    expect(mapMembershipSubStatus('unpaid', 'active')).toBe('past_due');
  });

  it('maps a recovery back to active', () => {
    expect(mapMembershipSubStatus('active', 'past_due')).toBe('active');
  });

  it('maps a Stripe cancel to cancelled', () => {
    expect(mapMembershipSubStatus('canceled', 'past_due')).toBe('cancelled');
  });

  it('never resurrects a terminally cancelled membership', () => {
    expect(mapMembershipSubStatus('active', 'cancelled')).toBeNull();
    expect(mapMembershipSubStatus('past_due', 'cancelled')).toBeNull();
  });

  it('leaves statuses Stripe does not model unchanged', () => {
    expect(mapMembershipSubStatus('trialing', 'active')).toBeNull();
    expect(mapMembershipSubStatus('incomplete', 'pending')).toBeNull();
    expect(mapMembershipSubStatus(undefined, 'active')).toBeNull();
  });
});
