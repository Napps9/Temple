import { describe, expect, it } from 'vitest';

import { can } from './can';

// The client default matrix must mirror the SQL default_capability arms
// (supabase/migrations/0116 for retention). This locks the retention row
// so a drift between the two surfaces trips a test rather than shipping.
describe('can — retention defaults mirror the SQL matrix', () => {
  it('grants an owner, admin and coach by default', () => {
    expect(can('owner', 'can_see_retention')).toBe(true);
    expect(can('admin', 'can_see_retention')).toBe(true);
    expect(can('coach', 'can_see_retention')).toBe(true);
  });

  it('denies front-desk staff and members by default', () => {
    expect(can('staff', 'can_see_retention')).toBe(false);
    expect(can('member', 'can_see_retention')).toBe(false);
  });

  it('denies when there is no role', () => {
    expect(can(null, 'can_see_retention')).toBe(false);
  });
});
