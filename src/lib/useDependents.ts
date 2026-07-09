import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type Dependent = {
  id: string;
  fullName: string | null;
  dob: string | null;
};

// The caller's dependents (children they manage). guardianships RLS returns
// only the caller's own links; the dependent profile is readable because
// parent and child share a gym (profiles_gym_member_select).
export function useDependents() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['dependents', session?.user.id, membership?.gymId],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Dependent[]> => {
      const { data, error } = await supabase
        .from('guardianships')
        .select(
          'dependent_profile_id, profiles!dependent_profile_id(full_name, date_of_birth)',
        );
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as unknown as {
          dependent_profile_id: string;
          profiles: { full_name: string | null; date_of_birth: string | null } | null;
        };
        return {
          id: row.dependent_profile_id,
          fullName: row.profiles?.full_name ?? null,
          dob: row.profiles?.date_of_birth ?? null,
        };
      });
    },
  });
}
