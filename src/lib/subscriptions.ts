import { useMutation, useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { MembershipPlanKind, PlanSubState } from '@/types/database';

function checkoutOrigin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://app.jointemple.io';
}

// Starts a Stripe Checkout for a plan via the stripe-checkout edge
// function and sends the browser to the returned URL. Shared by the
// Membership page and the in-booking purchase prompt. mutate(planId).
export function useStartCheckout(gymId: string | undefined) {
  return useMutation({
    mutationFn: async (planId: string) => {
      if (!gymId) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { gym_id: gymId, plan_id: planId, origin: checkoutOrigin() },
      });
      if (error) {
        // FunctionsHttpError carries the raw Response in .context — our
        // edge functions answer with { error }, so surface that.
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) msg = String(body.error);
          } catch {
            // not JSON — keep the generic message
          }
        }
        throw new Error(msg);
      }
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('Could not start checkout');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = url;
        return;
      }
      throw new Error('Paying online is only available on the web for now.');
    },
  });
}

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
