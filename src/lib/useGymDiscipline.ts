import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import type { Discipline } from '@/lib/movements';
import { supabase } from '@/lib/supabase';

// The active gym's Track flavour. Defaults to 'crossfit' while loading
// or when no gym is in context, so every consumer can render the
// CrossFit catalog without a null check.
export function useGymDiscipline(): Discipline {
  const { data: membership } = useGymMembership();
  const { data } = useQuery({
    queryKey: ['gym-discipline', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: 60_000,
    queryFn: async (): Promise<Discipline> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('discipline')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return (data.discipline as Discipline) ?? 'crossfit';
    },
  });
  return data ?? 'crossfit';
}
