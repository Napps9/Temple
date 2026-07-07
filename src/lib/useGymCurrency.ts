import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// The active gym's billing currency (ISO 4217, e.g. 'GBP'). Drives how
// every money figure is formatted. Defaults to 'GBP' while loading or
// when no gym is in context. The value follows the gym's connected
// Stripe account (set at Connect time) and can be overridden in Gym
// settings.
export function useGymCurrency(): string {
  const { data: membership } = useGymMembership();
  const { data } = useQuery({
    queryKey: ['gym-currency', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: 60_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('currency')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.currency ?? 'GBP';
    },
  });
  return data ?? 'GBP';
}
