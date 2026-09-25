import { describe, expect, it } from 'vitest';

import { backdatedCreatedAt, pickOwnedGym, withoutOwnerRows, type OwnedGym } from './attach';
import { buildDemoPlan } from './plan';

const gym = (slug: string): OwnedGym => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  timezone: 'Europe/London',
  currency: 'GBP',
  created_at: '2026-09-20T09:00:00.000Z',
});

describe('pickOwnedGym', () => {
  it('takes the only gym without a slug, and the named one among several', () => {
    expect(pickOwnedGym([gym('goodlife')], undefined).slug).toBe('goodlife');
    expect(pickOwnedGym([gym('goodlife'), gym('other')], 'other').slug).toBe('other');
  });

  it('refuses no gym, an ambiguous choice, and a slug this account does not own', () => {
    expect(() => pickOwnedGym([], undefined)).toThrow(/owns no gym/);
    expect(() => pickOwnedGym([gym('a'), gym('b')], undefined)).toThrow(/pass --slug.*a, b/);
    expect(() => pickOwnedGym([gym('a')], 'b')).toThrow(/does not own.*"b"/);
  });
});

describe('withoutOwnerRows', () => {
  const plan = buildDemoPlan({
    slug: 'goodlife',
    gymName: 'Goodlife',
    members: 12,
    weeksBack: 1,
    weeksForward: 1,
    historyWeeks: 2,
    tz: 'Europe/London',
    seed: 7,
    now: new Date('2026-09-25T08:00:00.000Z'),
    attach: true,
  });
  const owner = plan.users.find((u) => u.role === 'owner')!;
  const stripped = withoutOwnerRows(plan, owner.id);

  it('drops the owner account and membership, which the real gym already has', () => {
    expect(stripped.users.some((u) => u.role === 'owner')).toBe(false);
    expect(stripped.users).toHaveLength(plan.users.length - 1);
    expect(stripped.memberships.some((m) => m.profile_id === owner.id)).toBe(false);
    expect(stripped.memberships).toHaveLength(plan.memberships.length - 1);
  });

  it('keeps everything the owner authored or trained, ready to be remapped', () => {
    expect(stripped.sessions.every((s) => s.created_by === owner.id)).toBe(true);
    expect(stripped.workouts.some((w) => w.profile_id === owner.id)).toBe(true);
    expect(stripped.consents.some((c) => c.profile_id === owner.id)).toBe(true);
  });
});

describe('backdatedCreatedAt', () => {
  const now = new Date('2026-09-25T08:00:00.000Z');

  it('moves a young gym a year back so the Timeline can page into the seeded history', () => {
    expect(backdatedCreatedAt('2026-09-20T09:00:00.000Z', now)).toBe('2025-09-25T08:00:00.000Z');
  });

  it('leaves a gym older than the seeded history alone', () => {
    expect(backdatedCreatedAt('2024-01-01T00:00:00.000Z', now)).toBeNull();
  });
});
