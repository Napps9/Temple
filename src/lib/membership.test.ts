import { describe, expect, it } from 'vitest';

import { parseMembershipRow } from './membership';

describe('parseMembershipRow', () => {
  it('returns null when the row is null (no membership)', () => {
    expect(parseMembershipRow(null)).toBeNull();
    expect(parseMembershipRow(undefined)).toBeNull();
  });

  it('resolves an owner row with the gyms embed as an object', () => {
    const result = parseMembershipRow({
      gym_id: 'gym-1',
      role: 'owner',
      gyms: { name: 'Temple Gym' },
    });
    expect(result).toStrictEqual({
      gymId: 'gym-1',
      gymName: 'Temple Gym',
      role: 'owner',
    });
  });

  it('resolves an owner row when PostgREST returns the embed as a one-element array', () => {
    // PostgREST sometimes returns to-one relationships as a single-
    // element array depending on how the relationship is inferred.
    // The hook must accept both shapes.
    const result = parseMembershipRow({
      gym_id: 'gym-1',
      role: 'owner',
      gyms: [{ name: 'Temple Gym' }],
    });
    expect(result).toStrictEqual({
      gymId: 'gym-1',
      gymName: 'Temple Gym',
      role: 'owner',
    });
  });

  it('resolves with an empty gym name when the embed is null (RLS hid the gym)', () => {
    const result = parseMembershipRow({
      gym_id: 'gym-1',
      role: 'admin',
      gyms: null,
    });
    expect(result).toStrictEqual({
      gymId: 'gym-1',
      gymName: '',
      role: 'admin',
    });
  });

  it('resolves with an empty gym name when the embed is an empty array', () => {
    const result = parseMembershipRow({
      gym_id: 'gym-1',
      role: 'coach',
      gyms: [],
    });
    expect(result).toStrictEqual({
      gymId: 'gym-1',
      gymName: '',
      role: 'coach',
    });
  });

  it('falls back to empty string when gym.name itself is null', () => {
    const result = parseMembershipRow({
      gym_id: 'gym-1',
      role: 'staff',
      gyms: { name: null },
    });
    expect(result).toStrictEqual({
      gymId: 'gym-1',
      gymName: '',
      role: 'staff',
    });
  });

  it('returns null when the row is missing gym_id (treats as no membership rather than throwing)', () => {
    // Failing closed here is intentional: throwing would put the
    // React Query into an error state and trigger retries, which
    // is the exact loop we're trying to avoid.
    expect(
      parseMembershipRow({
        // @ts-expect-error — exercising malformed runtime data
        gym_id: undefined,
        role: 'owner',
        gyms: null,
      }),
    ).toBeNull();
  });

  it('returns null when the row is missing role', () => {
    expect(
      parseMembershipRow({
        gym_id: 'gym-1',
        // @ts-expect-error — exercising malformed runtime data
        role: undefined,
        gyms: null,
      }),
    ).toBeNull();
  });
});
