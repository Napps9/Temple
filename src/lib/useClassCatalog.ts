import { useQuery } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import { supabase } from './supabase';

// Canonical queries for the class-type catalog and recurrence schedules.
//
// These existed as four (types) + two (recurrences) inline useQuery
// calls that shared queryKeys but selected DIFFERENT columns. React
// Query keys one cache entry per key, so whichever queryFn ran last
// dictated the shape for everyone — with both the Classes tab and the
// Settings tab mounted, the two recurrence fns kept overwriting each
// other and the Class types editor visibly flashed between "No
// recurring schedule yet" and the real summary several times a second.
//
// Rule: one queryKey ⇒ one queryFn, selecting the superset. Consumers
// narrow client-side.

export type ClassTypeRow = {
  id: string;
  name: string;
  color: string;
  archived_at: string | null;
  booking_window_hours_ahead: number | null;
  booking_cutoff_minutes_before: number | null;
  cancel_cutoff_minutes_before: number | null;
  cancel_cutoff_mode: 'relative' | 'day_before' | null;
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number | null;
};

export function useClassTypes() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['class-types', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ClassTypeRow[]> => {
      const { data, error } = await supabase
        .from('class_types')
        .select(
          'id, name, color, archived_at, booking_window_hours_ahead, booking_cutoff_minutes_before, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before',
        )
        .eq('gym_id', membership!.gymId)
        .order('name');
      if (error) throw error;
      return (data ?? []) as ClassTypeRow[];
    },
  });
}

export type RecurrenceRow = {
  id: string;
  class_type_id: string;
  days_of_week: number[];
  times: string[];
  duration_minutes: number;
  capacity: number;
  starts_on: string;
  ends_on: string | null;
  materialized_until: string | null;
};

export function useClassRecurrences() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['class-recurrences', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<RecurrenceRow[]> => {
      const { data, error } = await supabase
        .from('class_recurrences')
        .select(
          'id, class_type_id, days_of_week, times, duration_minutes, capacity, starts_on, ends_on, materialized_until',
        )
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as RecurrenceRow[];
    },
  });
}
