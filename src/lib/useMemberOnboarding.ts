import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  CURRENT_SUB_STATUSES,
  useGymPlans,
  useMySubscriptions,
} from '@/lib/subscriptions';
import { useMyInjuries } from '@/lib/useInjuries';
import { useOnboardingFlags } from '@/lib/useOnboardingFlags';

// Live "get started" state for a new member, derived entirely from data:
// each step flips done when the member does the thing. Shared by the
// account-menu checklist and the avatar cue that hints there's something
// to do. Returns null the moment the member isn't eligible, hasn't
// loaded, has dismissed it, or has finished every required step — so a
// non-null result always means "show the nudge".

export type OnboardingStepKey =
  | 'membership'
  | 'book'
  | 'programming'
  | 'log'
  | 'injury';

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  done: boolean;
  optional?: boolean;
};

export type MemberOnboarding = {
  gymName: string;
  steps: OnboardingStep[];
  requiredDone: number;
  requiredTotal: number;
};

export function useMemberOnboarding(): MemberOnboarding | null {
  const { data: membership } = useGymMembership();
  const role = useRole();
  const session = useSession();
  const gymId = membership?.gymId;
  const userId = session?.user.id;
  const isMember = role === 'member' && !!gymId && !!userId;

  const plans = useGymPlans(gymId);
  const subs = useMySubscriptions(gymId, userId);
  const injuries = useMyInjuries();
  const flags = useOnboardingFlags();

  const bookings = useQuery({
    queryKey: ['member-onboarding-bookings', userId],
    enabled: isMember,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Shares the Track home's key so the count is cached across both.
  const workouts = useQuery({
    queryKey: ['tracked-journal-count', userId],
    enabled: isMember,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('tracked_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (!isMember || !membership) return null;
  if (
    plans.isLoading ||
    subs.isLoading ||
    bookings.isLoading ||
    workouts.isLoading ||
    injuries.isLoading ||
    flags.isLoading
  ) {
    return null;
  }
  if (flags.data?.getstarted_dismissed) return null;

  const hasPlans = (plans.data?.length ?? 0) > 0;
  const hasMembership = (subs.data ?? []).some((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );

  const steps: OnboardingStep[] = [
    ...(hasPlans
      ? [
          {
            key: 'membership' as const,
            label: 'Get your membership',
            description: 'Pick a plan so you can book into classes.',
            icon: 'card-outline' as const,
            done: hasMembership,
          },
        ]
      : []),
    {
      key: 'book',
      label: 'Book your first class',
      description: 'Browse the schedule and reserve your spot.',
      icon: 'calendar-outline',
      done: (bookings.data ?? 0) > 0,
    },
    {
      key: 'programming',
      label: "Peek at this week's programming",
      description: 'See what your coaches have planned so you know what to expect.',
      icon: 'barbell-outline',
      done: !!flags.data?.programming_peeked,
    },
    {
      key: 'log',
      label: 'Log your first result',
      description: 'Record a workout or a past PR — your training history is yours.',
      icon: 'stats-chart-outline',
      done: (workouts.data ?? 0) > 0,
    },
    {
      key: 'injury',
      label: 'Note any injuries',
      description: 'Tell us what to work around so coaches can scale movements for you.',
      icon: 'medkit-outline',
      optional: true,
      done: (injuries.data?.length ?? 0) > 0 || !!flags.data?.injury_answered,
    },
  ];

  const requiredSteps = steps.filter((s) => !s.optional);
  const requiredDone = requiredSteps.filter((s) => s.done).length;
  if (requiredDone === requiredSteps.length) return null;

  return {
    gymName: membership.gymName,
    steps,
    requiredDone,
    requiredTotal: requiredSteps.length,
  };
}
