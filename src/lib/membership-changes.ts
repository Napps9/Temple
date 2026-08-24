import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export type MembershipChangePolicy = 'self_serve' | 'request';

export type MembershipPolicies = {
  upgrade: MembershipChangePolicy;
  downgrade: MembershipChangePolicy;
  cancel: MembershipChangePolicy;
};

// The gym's self-serve-vs-approval rules per change direction. Member- and
// staff-readable (gyms tenant-select RLS).
export function useMembershipPolicies(gymId: string | undefined) {
  return useQuery({
    queryKey: ['membership-policies', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<MembershipPolicies> => {
      const { data, error } = await supabase
        .from('gyms')
        .select(
          'membership_upgrade_policy, membership_downgrade_policy, membership_cancel_policy',
        )
        .eq('id', gymId!)
        .single();
      if (error) throw error;
      return {
        upgrade: data.membership_upgrade_policy as MembershipChangePolicy,
        downgrade: data.membership_downgrade_policy as MembershipChangePolicy,
        cancel: data.membership_cancel_policy as MembershipChangePolicy,
      };
    },
  });
}

export type ChangeRequestKind = 'cancel' | 'switch_plan';
export type ChangeRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export type MyChangeRequest = {
  id: string;
  plan_subscription_id: string;
  kind: ChangeRequestKind;
  target_plan_id: string | null;
  status: ChangeRequestStatus;
  staff_note: string | null;
  created_at: string;
  decided_at: string | null;
};

// The caller's own change requests at this gym (membership_change_requests
// self-select RLS), newest first.
export function useMyChangeRequests(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  return useQuery({
    queryKey: ['my-change-requests', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<MyChangeRequest[]> => {
      const { data, error } = await supabase
        .from('membership_change_requests')
        .select(
          'id, plan_subscription_id, kind, target_plan_id, status, staff_note, created_at, decided_at',
        )
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MyChangeRequest[];
    },
  });
}

// File a change request for approval (a plain RLS insert — the member owns
// the row and the subscription). Used when the gym's policy for this
// direction is 'request'.
export function useFileChangeRequest(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      planSubscriptionId: string;
      kind: ChangeRequestKind;
      targetPlanId?: string;
      memberNote?: string;
    }) => {
      if (!gymId || !profileId) throw new Error('No gym');
      const { error } = await supabase.from('membership_change_requests').insert({
        gym_id: gymId,
        profile_id: profileId,
        plan_subscription_id: args.planSubscriptionId,
        kind: args.kind,
        target_plan_id: args.kind === 'switch_plan' ? args.targetPlanId : null,
        member_note: args.memberNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-change-requests', gymId, profileId] });
    },
  });
}

// Withdraw a pending request (RLS lets the member flip their own
// pending row to withdrawn).
export function useWithdrawChangeRequest(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('membership_change_requests')
        .update({ status: 'withdrawn' })
        .eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-change-requests', gymId, profileId] });
    },
  });
}

// Apply a self-serve change (switch plan or cancel) via the
// stripe-modify-subscription edge function. The server re-checks the gym's
// policy, so this only succeeds where the gym allows self-serve.
export function useModifySubscription(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      planSubscriptionId: string;
      kind: ChangeRequestKind;
      targetPlanId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-modify-subscription',
        {
          body: {
            action: 'self_serve',
            plan_subscription_id: args.planSubscriptionId,
            kind: args.kind,
            target_plan_id: args.targetPlanId,
          },
        },
      );
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const respBody = await ctx.json();
            if (respBody?.error) msg = String(respBody.error);
          } catch {
            // not JSON — keep the generic message
          }
        }
        throw new Error(msg);
      }
      return data as { ok?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-subscriptions', gymId, profileId] });
      qc.invalidateQueries({ queryKey: ['my-change-requests', gymId, profileId] });
    },
  });
}

export type SwitchPreview = {
  direction: 'upgrade' | 'downgrade';
  // Stripe's own pro-rated figure for an upgrade; null when the preview
  // fails (the confirm copy then says "the difference" without a number)
  // and always null for a downgrade — nothing is charged today.
  charge_today_cents: number | null;
  currency: string | null;
  notice_period_days?: number;
};

// What a switch would do before committing: the direction, and for an
// upgrade the exact charge Stripe would take today. Read-only — a
// mutation only because it runs on demand per plan, not per render.
export function usePreviewSwitch() {
  return useMutation({
    mutationFn: async (args: {
      planSubscriptionId: string;
      targetPlanId: string;
    }): Promise<SwitchPreview> => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-modify-subscription',
        {
          body: {
            action: 'preview_switch',
            plan_subscription_id: args.planSubscriptionId,
            target_plan_id: args.targetPlanId,
          },
        },
      );
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const respBody = await ctx.json();
            if (respBody?.error) msg = String(respBody.error);
          } catch {
            // not JSON — keep the generic message
          }
        }
        throw new Error(msg);
      }
      return data as SwitchPreview;
    },
  });
}

// Unschedule a pending plan change. The RPC allows the row's own member
// or staff with can_assign_plan; it raises when nothing is scheduled.
export function useCancelPendingChange(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planSubscriptionId: string) => {
      const { error } = await supabase.rpc('cancel_pending_plan_change', {
        p_plan_subscription_id: planSubscriptionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-subscriptions', gymId, profileId] });
    },
  });
}

// ============================================================================
// Staff side — the approval queue + the owner policy editor.
// ============================================================================

export type StaffChangeRequest = {
  id: string;
  profile_id: string;
  plan_subscription_id: string;
  kind: ChangeRequestKind;
  member_note: string | null;
  created_at: string;
  member_name: string | null;
  current_plan_name: string | null;
  target_plan_name: string | null;
};

// Pending requests for the gym, enriched with member + plan names. Gated
// server-side by user_can_assign_plan inside the RPC.
export function useChangeRequestQueue(gymId: string | undefined) {
  return useQuery({
    queryKey: ['change-request-queue', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<StaffChangeRequest[]> => {
      const { data, error } = await supabase.rpc(
        'staff_membership_change_requests',
        { p_gym_id: gymId! },
      );
      if (error) throw error;
      return (data ?? []) as StaffChangeRequest[];
    },
  });
}

// Approve or reject a pending request. Approve performs the Stripe change
// inside the stripe-modify-subscription edge function under the service
// role; reject just records the decision.
export function useDecideChangeRequest(gymId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      requestId: string;
      decision: 'approve' | 'reject';
      staffNote?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-modify-subscription',
        {
          body: {
            action: 'decide',
            request_id: args.requestId,
            decision: args.decision,
            staff_note: args.staffNote,
          },
        },
      );
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const respBody = await ctx.json();
            if (respBody?.error) msg = String(respBody.error);
          } catch {
            // not JSON — keep the generic message
          }
        }
        throw new Error(msg);
      }
      return data as { ok?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['change-request-queue', gymId] });
    },
  });
}

// Owner-only: set the three change policies at once (the RPC enforces it).
export function useSetMembershipPolicies(gymId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: MembershipPolicies) => {
      if (!gymId) throw new Error('No gym');
      const { error } = await supabase.rpc('set_membership_change_policies', {
        p_gym_id: gymId,
        p_upgrade: p.upgrade,
        p_downgrade: p.downgrade,
        p_cancel: p.cancel,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membership-policies', gymId] });
    },
  });
}
