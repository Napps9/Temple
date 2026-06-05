import { describe, expect, it } from 'vitest';

import { computeCan } from './can-resolver';

describe('computeCan', () => {
  it('returns undefined while membership is loading', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: true,
        role: null,
        overridesLoading: false,
        overrides: [],
      }),
    ).toBeUndefined();
  });

  it('returns false when there is no role (signed in but no gym membership)', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: null,
        overridesLoading: false,
        overrides: [],
      }),
    ).toBe(false);
  });

  // The regression this test exists to prevent: an owner being blocked
  // from the staff area. computeCan must return true for an owner
  // regardless of overrides loading state, overrides content, or
  // capability — owners always have every capability.
  it('returns true for an owner reaching can_access_staff_area with no overrides loaded yet', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: 'owner',
        overridesLoading: true,
        overrides: undefined,
      }),
    ).toBe(true);
  });

  it('returns true for an owner regardless of an override that says otherwise', () => {
    // Even if a malformed override row claims owner cannot access
    // staff, computeCan refuses to honor it — owner is structural.
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: 'owner',
        overridesLoading: false,
        overrides: [
          { role: 'owner', capability: 'can_access_staff_area', enabled: false },
        ],
      }),
    ).toBe(true);
  });

  it('returns true for an owner across every capability', () => {
    const caps = [
      'can_access_staff_area',
      'can_see_money',
      'can_manage_plans',
      'can_set_targets',
      'can_hard_delete',
    ] as const;
    for (const cap of caps) {
      expect(
        computeCan(cap, {
          membershipLoading: false,
          role: 'owner',
          overridesLoading: false,
          overrides: [],
        }),
      ).toBe(true);
    }
  });

  it('returns false for a member regardless of overrides', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: 'member',
        overridesLoading: false,
        overrides: [
          // Even an override trying to grant staff access to a member
          // is ignored — member is structural.
          { role: 'member', capability: 'can_access_staff_area', enabled: true },
        ],
      }),
    ).toBe(false);
  });

  it('returns undefined for non-owner/non-member while overrides are loading', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: 'admin',
        overridesLoading: true,
        overrides: undefined,
      }),
    ).toBeUndefined();
  });

  it('honors an admin override that disables a default-on capability', () => {
    expect(
      computeCan('can_access_staff_area', {
        membershipLoading: false,
        role: 'admin',
        overridesLoading: false,
        overrides: [
          { role: 'admin', capability: 'can_access_staff_area', enabled: false },
        ],
      }),
    ).toBe(false);
  });

  it('honors an admin override that enables a default-off capability', () => {
    expect(
      computeCan('can_see_money', {
        membershipLoading: false,
        role: 'admin',
        overridesLoading: false,
        overrides: [
          { role: 'admin', capability: 'can_see_money', enabled: true },
        ],
      }),
    ).toBe(true);
  });

  it('falls back to the baked-in matrix when no override exists for the role/capability', () => {
    // Coach has can_claim_cover by default; not by override.
    expect(
      computeCan('can_claim_cover', {
        membershipLoading: false,
        role: 'coach',
        overridesLoading: false,
        overrides: [],
      }),
    ).toBe(true);
    // Coach lacks can_invite by default.
    expect(
      computeCan('can_invite', {
        membershipLoading: false,
        role: 'coach',
        overridesLoading: false,
        overrides: [],
      }),
    ).toBe(false);
  });

  it('only consults override rows that match BOTH role and capability', () => {
    // An override for staff:can_invite must not leak into coach.
    expect(
      computeCan('can_invite', {
        membershipLoading: false,
        role: 'coach',
        overridesLoading: false,
        overrides: [
          { role: 'staff', capability: 'can_invite', enabled: true },
          { role: 'coach', capability: 'can_claim_cover', enabled: false },
        ],
      }),
    ).toBe(false); // coach default for can_invite
  });
});
