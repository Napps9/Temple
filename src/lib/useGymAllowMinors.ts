import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Whether the active gym has opted in to enrolling members under 18.
// Defaults to false (the schema default) while loading or with no gym in
// context — the safe assumption, since the consent flow blocks a minor when
// this is false.
export function useGymAllowMinors(): boolean {
  const { data: membership } = useGymMembership();
  const { data } = useQuery({
    queryKey: ['gym-allow-minors', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('allow_minors')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.allow_minors ?? false;
    },
  });
  return data ?? false;
}
