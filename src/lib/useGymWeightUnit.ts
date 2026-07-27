import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { WeightUnit } from '@/lib/weight';

// How the active gym wants weights DISPLAYED. Storage is always kilograms
// (0181). Defaults to 'kg' while loading or with no gym in context, so no
// consumer needs a null check — same shape as useGymDiscipline.
export function useGymWeightUnit(): WeightUnit {
  const { data: membership } = useGymMembership();
  const { data } = useQuery({
    queryKey: ['gym-weight-unit', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: 60_000,
    queryFn: async (): Promise<WeightUnit> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('weight_unit')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return (data.weight_unit as WeightUnit) ?? 'kg';
    },
  });
  return data ?? 'kg';
}
