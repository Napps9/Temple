import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import { FALLBACK_BRAND, type GymBrand } from './brand';
import { supabase } from './supabase';

// Read the brand for the signed-in member's gym. Drops back to the
// default palette + name 'Temple' until a membership resolves so the
// chrome never renders unstyled.
export function useGymBrand(): GymBrand {
  const { data: membership } = useGymMembership();
  const query = useQuery({
    queryKey: ['gym-brand', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<GymBrand> => {
      const { data, error } = await supabase
        .from('gyms')
        .select(
          'id, name, slug, logo_url, primary_color, secondary_color, text_color, public_signup_enabled',
        )
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return {
        gymId: data.id,
        gymName: data.name,
        slug: data.slug,
        logoUrl: data.logo_url,
        primaryColor: data.primary_color,
        secondaryColor: data.secondary_color,
        textColor: data.text_color,
        publicSignupEnabled: data.public_signup_enabled,
      };
    },
  });
  return query.data ?? FALLBACK_BRAND;
}
