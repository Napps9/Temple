// Seeding into a gym that already exists — one a real account created in
// the app and owns — rather than minting a demo tenant. The plan builder
// still produces every row with placeholder ids; these helpers decide
// which gym that is and which of its rows to drop, and the orchestrator
// remaps the gym and owner placeholders onto the real ids the same way it
// already remaps every account GoTrue mints.

import type { DemoPlan } from './plan';

export type OwnedGym = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  created_at: string;
};

// One owned gym needs no slug; several need one. A slug naming a gym this
// account does not own is refused rather than seeding somebody else's.
export function pickOwnedGym(gyms: OwnedGym[], slug: string | undefined): OwnedGym {
  if (gyms.length === 0) {
    throw new Error('this account owns no gym — create one in the app first.');
  }
  const slugs = gyms.map((g) => g.slug).join(', ');
  if (slug) {
    const match = gyms.find((g) => g.slug === slug);
    if (!match) {
      throw new Error(`this account does not own a gym with slug "${slug}" — it owns: ${slugs}.`);
    }
    return match;
  }
  if (gyms.length > 1) {
    throw new Error(`this account owns ${gyms.length} gyms — pass --slug to pick one: ${slugs}.`);
  }
  return gyms[0];
}

// The owner already has an account and a membership; the plan's copies
// would collide with them. Everything else that names the owner —
// created_by, their own month of training — is already remapped onto the
// real id by the time this runs, and stays.
export function withoutOwnerRows(plan: DemoPlan, ownerId: string): DemoPlan {
  return {
    ...plan,
    users: plan.users.filter((u) => u.id !== ownerId),
    memberships: plan.memberships.filter((m) => m.profile_id !== ownerId),
  };
}

// The Timeline's day pager floors at gyms.created_at (pagerBounds in
// src/lib/timeline-day.ts), so a gym made this week would hide every
// seeded week behind that floor. Null when the gym is already old enough.
export function backdatedCreatedAt(existingISO: string, now: Date): string | null {
  const floor = new Date(now.getTime() - 365 * 86_400_000);
  return new Date(existingISO) > floor ? floor.toISOString() : null;
}
