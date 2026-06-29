// Unique, collision-free test data. Every run stamps a fresh suffix so
// re-running against the same backend never trips the "one gym per
// account" guard, a duplicate slug, or a re-used email.

function suffix(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${rand}`;
}

export type OwnerAccount = {
  name: string;
  email: string;
  password: string;
  gymName: string;
  slug: string;
};

export type MemberAccount = {
  name: string;
  email: string;
  password: string;
  dob: string;
};

// A throwaway inbox domain. example.com is reserved by RFC 2606 so these
// never reach a real person even if the backend actually sends mail.
const EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? 'temple-e2e.example.com';

export function makeOwner(): OwnerAccount {
  const s = suffix();
  return {
    name: `E2E Owner ${s}`,
    email: `owner+${s}@${EMAIL_DOMAIN}`,
    password: 'Test-Passw0rd!',
    gymName: `E2E Gym ${s}`,
    slug: `e2e-gym-${s}`,
  };
}

export function makeMember(): MemberAccount {
  const s = suffix();
  return {
    name: `E2E Member ${s}`,
    email: `member+${s}@${EMAIL_DOMAIN}`,
    password: 'Test-Passw0rd!',
    dob: '1995-06-15',
  };
}

export const CLASS_TYPE_NAME = 'WOD';
