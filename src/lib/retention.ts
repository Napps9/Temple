import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

// Client access to the on-demand retention scorer (0122). The full row-level
// list drives the cockpit; the cheap summary drives the header tiles and the
// nav badge (never run the scorer just to render a count).

export type RetentionRiskRow =
  Database['public']['Functions']['compute_retention_risk']['Returns'][number];

export type RetentionSummary =
  Database['public']['Functions']['compute_retention_summary']['Returns'][number];

export type RetentionReason =
  | 'past_due'
  | 'expired'
  | 'expiring_soon'
  | 'attendance_decay'
  | 'never_attended';

const EMPTY_SUMMARY: RetentionSummary = {
  at_risk: 0,
  expiring: 0,
  past_due: 0,
  winback: 0,
};

export function useRetentionRisk() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['retention-risk', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<RetentionRiskRow[]> => {
      const { data, error } = await supabase.rpc('compute_retention_risk', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as RetentionRiskRow[];
    },
  });
}

export function useRetentionSummary() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['retention-summary', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<RetentionSummary> => {
      const { data, error } = await supabase.rpc('compute_retention_summary', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return ((data ?? [])[0] as RetentionSummary | undefined) ?? EMPTY_SUMMARY;
    },
  });
}
