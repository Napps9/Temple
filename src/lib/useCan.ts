import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import { can, type Capability } from './can';
import { supabase } from './supabase';
import type { GymRole } from '@/types/database';

type OverrideRow = {
  role: GymRole;
  capability: string;
  enabled: boolean;
};

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

// Returns true if the current user has the capability in the current
// gym, false if explicitly denied, undefined while membership/overrides
// are still loading. Mirrors effective_can() in SQL.
//
// The undefined-while-loading return lets callers distinguish "denied"
// from "not yet known":
//   - visibility gating: `{useCan('X') ? <Btn /> : null}` works either
//     way — undefined is falsy, so things stay hidden until data loads
//   - redirects: `if (useCan('X') === false) return <Redirect />` only
//     fires on an explicit denial, never on a still-loading state
//
// Owners always true and members always false short-circuit before the
// overrides query, so an owner viewing the staff area doesn't pay for
// a roundtrip and a member can never be granted a staff capability by
// a misconfigured override.
export function useCan(capability: Capability): boolean | undefined {
  const { data: membership, isLoading: membershipLoading } = useGymMembership();
  const { data: overrides, isLoading: overridesLoading } = useGymCapabilities();
  if (membershipLoading) return undefined;
  if (!membership) return false;
  if (membership.role === 'owner') return true;
  if (membership.role === 'member') return false;
  if (overridesLoading) return undefined;
  const override = overrides?.find(
    (o) => o.role === membership.role && o.capability === capability,
  );
  if (override) return override.enabled;
  return can(membership.role, capability);
}
