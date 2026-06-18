import { useQuery } from '@tanstack/react-query';

import { hasUsableMembership } from '@/lib/membership-access';
import { supabase } from '@/lib/supabase';
import type { MembershipPlanKind, PlanSubState } from '@/types/database';

export type GymPlan = {
  plan_id: string;
  name: string;
  kind: MembershipPlanKind;
  credit_count: number | null;
  monthly_price_cents: number | null;
  notice_period_days: number | null;
};

export type MySubscription = {
  id: string;
  plan_id: string;
  status: PlanSubState;
  credit_balance: number | null;
  paid_period_end: string | null;
  period_resets_at: string | null;
  cancelled_at: string | null;
  membership_plans: { name: string; kind: MembershipPlanKind } | null;
};

// The gym's live plan catalogue, member-readable (membership_plans
// tenant-select RLS). Cheapest first so it reads like a pricing page.
export function useGymPlans(gymId: string | undefined) {
  return useQuery({
    queryKey: ['gym-plans', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<GymPlan[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, monthly_price_cents, notice_period_days',
        )
        .eq('gym_id', gymId!)
        .is('archived_at', null)
        .order('monthly_price_cents', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as GymPlan[];
    },
  });
}

// The caller's own subscriptions at this gym (plan_subscriptions
// self-select RLS), newest first.
export function useMySubscriptions(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  return useQuery({
    queryKey: ['my-subscriptions', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<MySubscription[]> => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, plan_id, status, credit_balance, paid_period_end, period_resets_at, cancelled_at, membership_plans(name, kind)',
        )
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MySubscription[];
    },
  });
}

// gyms.members_can_self_checkout — whether to surface self-serve
// "Subscribe" buttons or point members at the front desk.
export function useGymSelfCheckout(gymId: string | undefined) {
  return useQuery({
    queryKey: ['gym-self-checkout', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('members_can_self_checkout')
        .eq('id', gymId!)
        .single();
      if (error) throw error;
      return data.members_can_self_checkout;
    },
  });
}

// Drives the booking gate. `sellsPlans` = the gym has a plan catalogue;
// `hasActiveMembership` reuses the SQL eligibility mirror (active sub or
// live comp). A plan-selling gym routes members with neither to the
// plans page; gyms with no catalogue let membership alone grant booking.
export function useMembershipAccess(
  gymId: string | undefined,
  profileId: string | undefined,
  enabled = true,
): { isLoading: boolean; sellsPlans: boolean; hasActiveMembership: boolean } {
  const plans = useGymPlans(enabled ? gymId : undefined);
  const subs = useMySubscriptions(enabled ? gymId : undefined, profileId);
  const comps = useQuery({
    queryKey: ['my-comp-grants', gymId, profileId],
    enabled: enabled && !!gymId && !!profileId,
    queryFn: async (): Promise<
      { starts_at: string; ends_at: string; revoked_at: string | null }[]
    > => {
      const { data, error } = await supabase
        .from('comp_grants')
        .select('starts_at, ends_at, revoked_at')
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!);
      if (error) throw error;
      return (data ?? []) as {
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
      }[];
    },
  });

  return {
    isLoading: plans.isLoading || subs.isLoading || comps.isLoading,
    sellsPlans: (plans.data?.length ?? 0) > 0,
    hasActiveMembership: hasUsableMembership(
      subs.data ?? [],
      comps.data ?? [],
      new Date().toISOString(),
    ),
  };
}

export const CURRENT_SUB_STATUSES: ReadonlySet<PlanSubState> = new Set<PlanSubState>([
  'active',
  'pending',
  'paused',
  'cancelled_at_period_end',
  'refunded_retained',
]);

export const SUB_STATUS_META: Record<
  PlanSubState,
  { label: string; tone: 'active' | 'warn' | 'muted' }
> = {
  active: { label: 'Active', tone: 'active' },
  pending: { label: 'Pending payment', tone: 'warn' },
  paused: { label: 'Paused', tone: 'muted' },
  cancelled_at_period_end: { label: 'Cancelling', tone: 'warn' },
  refunded_retained: { label: 'Active', tone: 'active' },
  lapsed: { label: 'Lapsed', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export function planPriceLabel(plan: {
  kind: MembershipPlanKind;
  monthly_price_cents: number | null;
}): string {
  if (plan.monthly_price_cents == null) return 'Free';
  const pounds = `£${(plan.monthly_price_cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')}`;
  return plan.kind === 'credit_pack' ? pounds : `${pounds}/mo`;
}

export function planKindLabel(plan: {
  kind: MembershipPlanKind;
  credit_count: number | null;
}): string {
  if (plan.kind === 'unlimited') return 'Unlimited classes';
  if (plan.kind === 'credit_period')
    return `${plan.credit_count ?? 0} classes each month`;
  return `${plan.credit_count ?? 0}-class pack`;
}
