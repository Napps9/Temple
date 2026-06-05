import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import { type Capability } from './can';
import {
  computeCan,
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

// Hook wrapper. Subscribes to membership + override queries and
// delegates the actual decision to the pure computeCan() function in
// can-resolver.ts (which is exercised by useCan.test.ts).
export function useCan(capability: Capability): boolean | undefined {
  const { data: membership, isLoading: membershipLoading } = useGymMembership();
  const { data: overrides, isLoading: overridesLoading } = useGymCapabilities();
  return computeCan(capability, {
    membershipLoading,
    role: membership?.role ?? null,
    overridesLoading,
    overrides,
  });
}
