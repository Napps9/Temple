import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type GymOperatingDefaults = {
  week_starts_on: 'mon' | 'sun';
  timezone: string;
  default_class_capacity: number;
  default_class_minutes: number;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  lead_conversion_window_days: number;
  materialisation_horizon_weeks: number;
  subscription_resolution:
    | 'credits_first'
    | 'newest_first'
    | 'highest_priority';
  booking_window_hours_ahead: number | null;
  booking_cutoff_minutes_before: number;
  cancel_cutoff_minutes_before: number;
  cancel_cutoff_mode: 'relative' | 'day_before';
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number;
};

// Per-gym dials that used to be hard-coded into the SQL. Every staff
// surface that previously assumed Monday-as-week-start or a 12-spot /
// 60-minute default class reads from here so the gym's setting
// actually drives the UI.
export function useGymOperatingDefaults() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['gym-operating-defaults', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<GymOperatingDefaults> => {
      const { data, error } = await supabase
        .from('gyms')
        .select(
          'week_starts_on, timezone, default_class_capacity, default_class_minutes, expiring_within_days, parq_expiry_days, health_retention_months, lead_conversion_window_days, materialisation_horizon_weeks, subscription_resolution, booking_window_hours_ahead, booking_cutoff_minutes_before, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before',
        )
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymOperatingDefaults;
    },
    staleTime: 60_000,
  });
}
