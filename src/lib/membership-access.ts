import type { PlanSubState } from '@/types/database';

// Pure "can this member book at all" logic, kept free of React /
// Supabase imports so it unit-tests without a bundler (same reason as
// booking-picker.ts). Mirrors the status half of the SQL eligibility
// predicate (0011), ignoring the per-class concerns (credits,
// class-type allowlist) the server still enforces at booking time.

export type AccessSub = { status: PlanSubState; paid_period_end: string | null };
export type AccessComp = {
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
};

// A sub grants access while active, or within the paid period after a
// cancel-at-period-end / refund-retain. All ISO 8601 strings, so lexical
// compare is chronological.
function subGrantsAccess(s: AccessSub, now: string): boolean {
  if (s.status === 'active') return true;
  return (
    (s.status === 'cancelled_at_period_end' || s.status === 'refunded_retained') &&
    s.paid_period_end !== null &&
    now <= s.paid_period_end
  );
}

function compGrantsAccess(c: AccessComp, now: string): boolean {
  return c.revoked_at === null && now >= c.starts_at && now < c.ends_at;
}

export function hasUsableMembership(
  subs: AccessSub[],
  comps: AccessComp[],
  now: string,
): boolean {
  return (
    subs.some((s) => subGrantsAccess(s, now)) ||
    comps.some((c) => compGrantsAccess(c, now))
  );
}
