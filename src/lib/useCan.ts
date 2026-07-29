import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useSession } from './auth';
import { type Capability } from './can';
import {
  computeCan,
  type MemberOverrideRow,
  type OverrideRow,
} from './can-resolver';
import { supabase } from './supabase';

// Fetches gym_role_capabilities for the current gym. RLS lets owners
// see all rows for their gym and everyone else see only rows for their
// own role — both are sufficient to drive useCan() locally.
//
// Tolerant of the table missing (e.g. before migration 0020 has been
// applied to a particular environment): we swallow the error and
// return [], which means useCan() falls back to the baked-in default
// matrix. That keeps the staff area accessible while ops apply the
// migration, rather than indefinitely blocking everyone whose role
// isn't owner.
//
// Same staleTime treatment as useGymMembership so re-mounts of useCan()
// observers don't kick off fresh fetches.
export function useGymCapabilities() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['role-capabilities', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async (): Promise<OverrideRow[]> => {
      const { data, error } = await supabase
        .from('gym_role_capabilities')
        .select('role, capability, enabled')
        .eq('gym_id', membership!.gymId);
      if (error) return [];
      return (data ?? []) as OverrideRow[];
    },
  });
}

// The current user's per-member capability overrides (0127). RLS lets a
// user read their own rows; owners read all. Same missing-table tolerance
// as useGymCapabilities — an error yields [], so useCan falls back to the
// role layer.
export function useMyMemberCapabilities() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['member-capabilities', membership?.gymId, session?.user.id],
    enabled: !!membership?.gymId && !!session?.user.id,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async (): Promise<MemberOverrideRow[]> => {
      const { data, error } = await supabase
        .from('gym_member_capabilities')
        .select('capability, enabled')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id);
      if (error) return [];
      return (data ?? []) as MemberOverrideRow[];
    },
  });
}

// Hook wrapper. Subscribes to session + membership + override state
// and delegates the actual decision to the pure computeCan() function
// in can-resolver.ts (exercised by can-resolver.test.ts).
//
// Subscribing to the session here is what makes the resolver "wait"
// before redirecting: while session === undefined (still being read
// from storage) computeCan returns undefined, so the staff layout's
// `if (canAccessStaff === false)` redirect does not fire on the very
// first render after a route-group transition.
export function useCan(capability: Capability): boolean | undefined {
  return useCanFn()(capability);
}

// The same decision, as a function, for callers asking about a set rather
// than a single key — the action registry filters its whole catalogue
// through this before the bar's vocabulary is sent anywhere.
export function useCanFn(): (capability: Capability) => boolean | undefined {
  const session = useSession();
  const { data: membership, isLoading: membershipLoading } = useGymMembership();
  const { data: overrides, isLoading: overridesLoading } = useGymCapabilities();
  const { data: memberOverrides, isLoading: memberOverridesLoading } =
    useMyMemberCapabilities();
  return (capability) =>
    computeCan(capability, {
      sessionPending: session === undefined,
      membershipLoading,
      role: membership?.role ?? null,
      overridesLoading,
      overrides,
      memberOverridesLoading,
      memberOverrides,
    });
}
