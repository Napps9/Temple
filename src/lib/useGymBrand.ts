import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useGymMembership } from './auth';
import { FALLBACK_GYM, type GymIdentity } from './brand';
import { supabase } from './supabase';

type GymRow = {
  id: string;
  name: string;
  slug: string;
  public_signup_enabled: boolean;
};

// Who the signed-in member's gym is. This used to resolve a whole brand
// — two logos and six colours, with the dark set derived from the light
// one when unset — because a gym recoloured Temple's chrome and replaced
// its mark. Gyms are named now, not painted, so what is left is identity:
// the name the chrome shows, and the slug its share links are built from.
export function useGymBrand(): GymIdentity {
  const { data: membership } = useGymMembership();
  const query = useQuery({
    queryKey: ['gym-brand', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<GymRow> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('id, name, slug, public_signup_enabled')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymRow;
    },
  });

  return useMemo<GymIdentity>(() => {
    if (!query.data) return FALLBACK_GYM;
    const row = query.data;
    return {
      gymId: row.id,
      gymName: row.name,
      slug: row.slug,
      publicSignupEnabled: row.public_signup_enabled,
    };
  }, [query.data]);
}
