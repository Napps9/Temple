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
export function useStartCheckout(
  gymId: string | undefined,
  opts?: { successPath?: string },
) {
  return useMutation({
    mutationFn: async (planId: string) => {
      if (!gymId) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: {
          gym_id: gymId,
          plan_id: planId,
          origin: checkoutOrigin(),
          success_path: opts?.successPath,
        },
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
  created_at: string;
  price_cents: number | null;
  membership_plans: {
    name: string;
    kind: MembershipPlanKind;
    credit_count: number | null;
    monthly_price_cents: number | null;
    notice_period_days: number | null;
  } | null;
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
  opts?: { pollUntilCurrent?: boolean },
) {
  return useQuery({
    queryKey: ['my-subscriptions', gymId, profileId],
    enabled: !!gymId && !!profileId,
    // After checkout the webhook records the subscription a few seconds
    // later. Poll so the member sees it activate without a manual reload,
    // and stop the moment a current subscription is present.
    refetchInterval: opts?.pollUntilCurrent
      ? (query) => {
          const data = query.state.data as MySubscription[] | undefined;
          const hasCurrent =
            !!data && data.some((s) => CURRENT_SUB_STATUSES.has(s.status));
          return hasCurrent ? false : 4000;
        }
      : false,
    queryFn: async (): Promise<MySubscription[]> => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, plan_id, status, credit_balance, paid_period_end, period_resets_at, cancelled_at, created_at, price_cents, membership_plans(name, kind, credit_count, monthly_price_cents, notice_period_days)',
        )
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MySubscription[];
    },
  });
}

export type MemberInvoice = {
  provider_event_id: string;
  kind: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  plan_subscription_id: string | null;
  invoice_url: string | null;
  invoice_pdf: string | null;
  invoice_number: string | null;
};

// The caller's own billing history at this gym (billing_events
// self-select RLS), newest first, with the Stripe-hosted invoice + PDF
// links pulled out of the payload. Stripe records both a setup event and
// an invoice for the first subscription payment, so collapse rows that
// represent the same charge, keeping the one that carries the invoice.
export function useMyInvoices(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  return useQuery({
    queryKey: ['my-invoices', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<MemberInvoice[]> => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(
          'provider_event_id, kind, amount_cents, currency, occurred_at, plan_subscription_id, payload',
        )
        .eq('gym_id', gymId!)
        .eq('member_id', profileId!)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      const str = (v: unknown): string | null =>
        typeof v === 'string' ? v : null;
      const rows: MemberInvoice[] = (data ?? []).map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        return {
          provider_event_id: r.provider_event_id,
          kind: r.kind,
          amount_cents: r.amount_cents,
          currency: r.currency,
          occurred_at: r.occurred_at,
          plan_subscription_id: r.plan_subscription_id,
          invoice_url: str(p.hosted_invoice_url),
          invoice_pdf: str(p.invoice_pdf),
          invoice_number: str(p.number),
        };
      });
      // Collapse the checkout + invoice pair Stripe emits for the first
      // subscription payment, keeping whichever row carries the invoice.
      const byCharge = new Map<string, MemberInvoice>();
      for (const row of rows) {
        const key = `${row.plan_subscription_id ?? row.provider_event_id}|${row.occurred_at.slice(0, 10)}|${row.amount_cents}`;
        const existing = byCharge.get(key);
        if (!existing || (!existing.invoice_url && row.invoice_url)) {
          byCharge.set(key, row);
        }
      }
      return [...byCharge.values()].sort((a, b) =>
        b.occurred_at.localeCompare(a.occurred_at),
      );
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
  if (plan.kind === 'programming_only')
    return 'Individualised programming — no class booking';
  if (plan.kind === 'credit_period')
    return `${plan.credit_count ?? 0} classes each month`;
  return `${plan.credit_count ?? 0}-class pack`;
}
