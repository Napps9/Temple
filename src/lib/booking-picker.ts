import type { MembershipPlanKind, PlanSubState } from '@/types/database';

// TS mirror of the SQL eligibility predicate, the single-source
// default picker (select_default_entitlement), and the two derived
// cohort predicates (is_active_relationship, has_ever_paid). The
// SQL implementations live in supabase/migrations/0011_*.sql; both
// sides consume the same fixture set (booking-picker.fixtures.ts).
//
// All timestamps are ISO 8601 strings. Lex compare = chronological
// compare for that format, so string ordering is safe.

export type PickerCompGrant = {
  grant_id: string;
  starts_at: string;
  ends_at: string;
  credits_total: number | null;
  credits_remaining: number | null;
  class_type_allowlist: string[];
  revoked_at: string | null;
};

export type PickerPlanSubscription = {
  id: string;
  plan_id: string;
  status: PlanSubState;
  credit_balance: number | null;
  paid_period_end: string | null;
  plan_kind: MembershipPlanKind;
  plan_class_types: string[];
};

export type PickerInput = {
  class_starts_at: string;
  class_type_id: string;
  comp_grants: PickerCompGrant[];
  plan_subscriptions: PickerPlanSubscription[];
};

export type PickerCandidate =
  | { kind: 'comp_grant'; id: string }
  | { kind: 'plan_subscription'; id: string };

function isCompGrantEligible(
  cg: PickerCompGrant,
  classStartsAt: string,
  classTypeId: string,
): boolean {
  if (cg.revoked_at !== null) return false;
  if (classStartsAt < cg.starts_at || classStartsAt >= cg.ends_at) return false;
  if (cg.credits_total !== null && (cg.credits_remaining ?? 0) <= 0) return false;
  if (
    cg.class_type_allowlist.length > 0 &&
    !cg.class_type_allowlist.includes(classTypeId)
  ) {
    return false;
  }
  return true;
}

function isPlanSubEligible(
  ps: PickerPlanSubscription,
  classStartsAt: string,
  classTypeId: string,
): boolean {
  const statusOk =
    ps.status === 'active' ||
    ((ps.status === 'cancelled_at_period_end' || ps.status === 'refunded_retained') &&
      ps.paid_period_end !== null &&
      classStartsAt <= ps.paid_period_end);
  if (!statusOk) return false;
  if (ps.plan_kind !== 'unlimited' && (ps.credit_balance ?? 0) <= 0) return false;
  if (
    ps.plan_class_types.length > 0 &&
    !ps.plan_class_types.includes(classTypeId)
  ) {
    return false;
  }
  return true;
}

export function isBookingEligible(input: PickerInput): boolean {
  return (
    input.comp_grants.some(cg =>
      isCompGrantEligible(cg, input.class_starts_at, input.class_type_id),
    ) ||
    input.plan_subscriptions.some(ps =>
      isPlanSubEligible(ps, input.class_starts_at, input.class_type_id),
    )
  );
}

export function selectDefaultEntitlement(input: PickerInput): PickerCandidate | null {
  const { class_starts_at, class_type_id, comp_grants, plan_subscriptions } = input;

  const eligibleComps = comp_grants
    .filter(cg => isCompGrantEligible(cg, class_starts_at, class_type_id))
    .sort((a, b) => a.ends_at.localeCompare(b.ends_at));
  if (eligibleComps.length > 0) {
    return { kind: 'comp_grant', id: eligibleComps[0].grant_id };
  }

  const eligiblePlans = plan_subscriptions.filter(ps =>
    isPlanSubEligible(ps, class_starts_at, class_type_id),
  );

  const creditBased = eligiblePlans
    .filter(ps => ps.plan_kind !== 'unlimited')
    .sort((a, b) => {
      // NULLS LAST: '￿' is greater than any ISO 8601 timestamp.
      const ax = a.paid_period_end ?? '￿';
      const bx = b.paid_period_end ?? '￿';
      return ax.localeCompare(bx);
    });
  if (creditBased.length > 0) {
    return { kind: 'plan_subscription', id: creditBased[0].id };
  }

  const unlimited = eligiblePlans.find(ps => ps.plan_kind === 'unlimited');
  if (unlimited) return { kind: 'plan_subscription', id: unlimited.id };

  return null;
}

// §0.6 derived cohort predicates

export type ActivityInput = {
  now: string;
  plan_subscriptions: Pick<PickerPlanSubscription, 'status'>[];
  comp_grants: Pick<PickerCompGrant, 'starts_at' | 'ends_at' | 'revoked_at'>[];
};

// Mirrors is_active_relationship's status set in SQL
// (0011 + 0118). 'past_due' is active-but-at-risk: a failing renewal is
// still a live relationship, not a departure — it must not fall into the
// is_expired cohort. Booking eligibility is stricter (see isPlanSubEligible)
// and deliberately excludes past_due.
const ACTIVE_SUB_STATUSES: ReadonlySet<PlanSubState> = new Set<PlanSubState>([
  'active',
  'pending',
  'paused',
  'cancelled_at_period_end',
  'past_due',
]);

export function isActiveRelationship(input: ActivityInput): boolean {
  const hasActiveSub = input.plan_subscriptions.some(ps =>
    ACTIVE_SUB_STATUSES.has(ps.status),
  );
  const hasLiveGrant = input.comp_grants.some(
    cg =>
      cg.revoked_at === null &&
      input.now >= cg.starts_at &&
      input.now < cg.ends_at,
  );
  return hasActiveSub || hasLiveGrant;
}

export type PaidBillingEvent = { kind: string };

export type PaidInput = {
  billing_events: PaidBillingEvent[];
};

// Per plan §3.2, only charge.succeeded and invoice.paid represent a
// cleared charge that flips plan_subscriptions.status pending→active
// or extends paid_period_end. Refund kinds appear in billing_events
// but must not register as paying activity.
const PAID_KINDS: ReadonlySet<string> = new Set([
  'charge.succeeded',
  'invoice.paid',
]);

export function hasEverPaid(input: PaidInput): boolean {
  return input.billing_events.some(be => PAID_KINDS.has(be.kind));
}
