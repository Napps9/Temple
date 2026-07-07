// The gym's website row, shared between the editor screen and the
// domain sub-page under one query key. Both screens reading (and the
// editor writing via setQueryData) the same ['gym-website', gymId]
// entry is what keeps them coherent — a second key for the same row
// previously let a stale "no site yet" answer redirect users away from
// the domain page right after they created their site.

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export type SiteRow = {
  id: string;
  gym_id: string;
  theme: string;
  design: Json;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export function useGymWebsite(gymId: string | null | undefined) {
  return useQuery({
    queryKey: ['gym-website', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<SiteRow | null> => {
      const { data, error } = await supabase
        .from('gym_websites')
        .select('*')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return data as SiteRow | null;
    },
  });
}
