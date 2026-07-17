import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useGymMembership, useRole } from './auth';
import { supabase } from './supabase';

type ProgressRow = {
  step_key: string;
  done: boolean;
  complete: number;
  target: number;
};

// Bounces an owner back to the /onboarding checklist the moment a setup
// step they opened from it (deep-linked with ?backTo=setup) is complete,
// so first-time setup reads as one guided flow rather than a tour of
// Manage pages you have to navigate back from yourself.
//
// Inert unless the page was opened from the checklist. Watches the same
// gym-setup-progress query the checklist itself renders from — the step
// pages invalidate it on save — and only reacts to a false -> true
// transition, so re-opening an already-done step to review it never
// ejects the owner.
//
// `requireFullRing` waits for every sub-item instead of the step's `done`
// flag. Used by "class type & schedule", whose step counts as done on the
// type alone but isn't useful without a schedule.
export function useSetupAutoReturn(stepKey: string, requireFullRing = false) {
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const active = backTo === 'setup' && role === 'owner' && !!membership?.gymId;

  const seeded = useRef<boolean | null>(null);
  const navigated = useRef(false);

  const progress = useQuery({
    queryKey: ['gym-setup-progress', membership?.gymId],
    enabled: active,
    queryFn: async (): Promise<ProgressRow[]> => {
      const { data, error } = await supabase.rpc('get_gym_setup_progress', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as ProgressRow[];
    },
  });

  useEffect(() => {
    if (!active || navigated.current) return;
    const row = progress.data?.find((r) => r.step_key === stepKey);
    if (!row) return;
    const complete = requireFullRing ? row.complete >= row.target : row.done;
    if (seeded.current === null) {
      seeded.current = complete;
      return;
    }
    if (!seeded.current && complete) {
      navigated.current = true;
      router.replace('/onboarding');
    }
  }, [active, progress.data, stepKey, requireFullRing]);
}
