// Pure mapping from a Stripe subscription status to our membership
// plan_subscriptions.status. Kept dependency-free so it runs under Deno
// (the stripe-webhook function) and is unit-testable under vitest/node
// (src/lib/subscription-status.test.ts) without importing either runtime.
//
// Membership subs previously ignored customer.subscription.updated entirely,
// so a failing renewal was invisible until Stripe deleted the sub. This maps
// the failing/recovered states so the retention cockpit can see past_due.

export type MembershipSubStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'cancelled_at_period_end'
  | 'lapsed'
  | 'cancelled'
  | 'refunded_retained'
  | 'past_due';

// Returns the status to write, or null for "leave it unchanged".
//   - 'cancelled' is terminal: a stale/out-of-order event must never
//     resurrect a cancelled membership.
//   - past_due / unpaid → past_due (at-risk, still an active relationship).
//   - active → active (recovery after a failed charge cleared).
//   - anything else (trialing, incomplete, paused server-side, …) → no change,
//     so we never clobber a status the app owns with one Stripe doesn't model.
export function mapMembershipSubStatus(
  stripeStatus: string | null | undefined,
  existingStatus: MembershipSubStatus | null | undefined,
): MembershipSubStatus | null {
  if (existingStatus === 'cancelled') return null;
  switch (stripeStatus) {
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'active':
      return 'active';
    case 'canceled':
      return 'cancelled';
    default:
      return null;
  }
}
