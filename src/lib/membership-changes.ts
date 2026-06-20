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
