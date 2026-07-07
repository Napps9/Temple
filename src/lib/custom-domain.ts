// Client-side hooks for the per-gym custom domain feature, mirroring
// useSendingDomain / useSendingDomainAction in src/lib/comms.ts — same
// read-then-invoke-an-edge-function shape, applied to gym_website_domains
// + the custom-domain edge function instead of gym_sending_domains +
// sending-domain. Pure validation/status helpers live in
// src/lib/site-domain.ts so they can be unit-tested without pulling in
// this file's @/lib/supabase import.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { functionErrorMessage } from '@/lib/errors';
import type { CustomDomainStatus } from '@/lib/site-domain';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type CustomDomainRow = Database['public']['Tables']['gym_website_domains']['Row'];

export function useCustomDomain(gymId: string | null | undefined) {
  return useQuery({
    queryKey: ['website-custom-domain', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<CustomDomainRow | null> => {
      const { data, error } = await supabase
        .from('gym_website_domains')
        .select('*')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return (data as CustomDomainRow) ?? null;
    },
  });
}

type CustomDomainAction =
  | { action: 'connect'; domain: string }
  | { action: 'verify' }
  | { action: 'disconnect' };

type CustomDomainActionResult = {
  status?: CustomDomainStatus;
  // Verify-time detail: ownership (TXT challenge) and DNS routing are
  // separate Vercel signals — the card uses these to say precisely what
  // the gym is still waiting on.
  ownership_verified?: boolean;
  error_message?: string;
};

export function useCustomDomainAction(gymId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation<CustomDomainActionResult, Error, CustomDomainAction>({
    mutationFn: async (input) => {
      if (!gymId) throw new Error('No gym selected');
      const { data, error } = await supabase.functions.invoke('custom-domain', {
        body: { ...input, gym_id: gymId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      return (data as CustomDomainActionResult) ?? {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website-custom-domain'] });
    },
  });
}
