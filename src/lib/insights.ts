import type { PlanSubState } from '@/types/database';

import {
  hasEverPaid,
  isActiveRelationship,
  type ActivityInput,
  type PaidBillingEvent,
  type PickerCompGrant,
  type PickerPlanSubscription,
} from './booking-picker';

// TS mirror of v_member_cohort. SQL lives in
// supabase/migrations/0014_tier5_rpcs_and_views.sql; this file runs
// against the same fixture set (insights.fixtures.ts) to prove
// SQL↔TS parity, mirroring the booking-picker pattern.

export type CohortInput = {
  now: string;
  joined_at: string;
  plan_subscriptions: Pick<PickerPlanSubscription, 'status' | 'paid_period_end'>[];
  comp_grants: Pick<
    PickerCompGrant,
    'starts_at' | 'ends_at' | 'revoked_at'
  >[];
  billing_events: PaidBillingEvent[];
};

export type CohortFlags = {
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_DEFAULT_DAYS = 7;

// Mirrors extract(day from (target - now)) when target > now.
// SQL extract(day from interval) is the day component of the
// interval, which equals Math.floor(total_hours / 24) when there's
// no month/year component (timestamptz subtraction never produces
// month/year).
function integerDaysBetween(now: string, target: string): number {
  const ms = new Date(target).getTime() - new Date(now).getTime();
  return Math.floor(ms / DAY_MS);
}

const EXPIRING_SUB_STATES: ReadonlySet<PlanSubState> = new Set<PlanSubState>([
  'active',
  'cancelled_at_period_end',
  'refunded_retained',
]);

export function classifyMember(input: CohortInput): CohortFlags {
  const activityInput: ActivityInput = {
    now: input.now,
    plan_subscriptions: input.plan_subscriptions.map(ps => ({ status: ps.status })),
    comp_grants: input.comp_grants.map(cg => ({
      starts_at: cg.starts_at,
      ends_at: cg.ends_at,
      revoked_at: cg.revoked_at,
    })),
  };

  const is_active = isActiveRelationship(activityInput);
  const is_paying = hasEverPaid({ billing_events: input.billing_events });

  const hasLiveComp = input.comp_grants.some(
    cg =>
      cg.revoked_at === null &&
      input.now >= cg.starts_at &&
      input.now < cg.ends_at,
  );

  const is_intro = hasLiveComp && !is_paying;

  const planDays = input.plan_subscriptions
    .filter(
      (ps): ps is typeof ps & { paid_period_end: string } =>
        EXPIRING_SUB_STATES.has(ps.status) &&
        ps.paid_period_end !== null &&
        ps.paid_period_end > input.now,
    )
    .map(ps => integerDaysBetween(input.now, ps.paid_period_end));

  const compDays = input.comp_grants
    .filter(cg => cg.revoked_at === null && cg.ends_at > input.now)
    .map(cg => integerDaysBetween(input.now, cg.ends_at));

  const candidates = [...planDays, ...compDays];
  const days_until_expiry =
    candidates.length > 0 ? Math.min(...candidates) : null;

  const is_expiring_soon =
    days_until_expiry !== null &&
    days_until_expiry >= 0 &&
    days_until_expiry <= EXPIRING_DEFAULT_DAYS;

  const everHadPlan = input.plan_subscriptions.length > 0;
  const everHadComp = input.comp_grants.length > 0;
  const is_expired = !is_active && (everHadPlan || everHadComp);

  return {
    joined_at: input.joined_at,
    is_intro,
    is_paying,
    is_active,
    is_expiring_soon,
    is_expired,
    days_until_expiry,
  };
}

// Aggregate-level numbers (intros count over window, conversion
// count, etc.) come from compute_insight_summary in SQL — the
// definitive RPC. The TS surface here is the per-member classifier
// only; that's the thing the SQL view and the TS lib must agree on.
