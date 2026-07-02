import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { StatusDisk } from '@/components/StatusDisk';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { CURRENT_SUB_STATUSES, useGymPlans, useMySubscriptions } from '@/lib/subscriptions';
import { useMyInjuries } from '@/lib/useInjuries';
import { useOnboardingFlags, useSetOnboardingFlag } from '@/lib/useOnboardingFlags';
import { useThemeColors } from '@/lib/theme';

// New-member onboarding nudge, shown at the top of Book. Mirrors the
// owner GymSetupChecklist: each step is derived from live data, the card
// collapses to a quiet header + progress bar, and the whole thing
// disappears once every *required* step is done so it never nags a
// settled-in member. Members only — staff/coaches don't need it.
//
// The "Get your membership" step only appears when the gym actually sells
// plans; a gym that doesn't would otherwise leave the step permanently
// unfinished and keep the card alive forever.

type Step = {
  key: 'membership' | 'book' | 'programming' | 'log' | 'injury';
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  done: boolean;
  optional?: boolean;
  // What tapping the row does. Most steps deep-link elsewhere; the
  // "book" step lives on this very screen, so it just collapses the card
  // to reveal the schedule underneath instead of navigating nowhere.
  onPress: () => void;
};

export function MemberGetStartedChecklist() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const session = useSession();
  const gymId = membership?.gymId;
  const userId = session?.user.id;

  const [open, setOpen] = useState(false);

  const plans = useGymPlans(gymId);
  const subs = useMySubscriptions(gymId, userId);
  const injuries = useMyInjuries();
  const flags = useOnboardingFlags();
  const setFlag = useSetOnboardingFlag();

  const bookings = useQuery({
    queryKey: ['member-onboarding-bookings', userId],
    enabled: !!userId,
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
    enabled: !!userId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('tracked_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (role !== 'member') return null;
  if (!gymId || !userId) return null;
  // Wait until every signal is in so steps don't flip done under the user.
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
  // Member tapped "Skip for now" — don't nag once they've dismissed it,
  // even if steps are still outstanding.
  if (flags.data?.getstarted_dismissed) return null;

  const hasPlans = (plans.data?.length ?? 0) > 0;
  const hasMembership = (subs.data ?? []).some((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );

  const steps: Step[] = [
    ...(hasPlans
      ? [
          {
            key: 'membership' as const,
            label: 'Get your membership',
            description: 'Pick a plan so you can book into classes.',
            icon: 'card-outline' as const,
            done: hasMembership,
            onPress: () => router.push('/membership' as never),
          },
        ]
      : []),
    {
      key: 'book',
      label: 'Book your first class',
      description: 'Browse the schedule below and reserve your spot.',
      icon: 'calendar-outline',
      done: (bookings.data ?? 0) > 0,
      onPress: () => setOpen(false),
    },
    {
      key: 'programming',
      label: "Peek at this week's programming",
      description: 'See what your coaches have planned so you know what to expect.',
      icon: 'barbell-outline',
      done: !!flags.data?.programming_peeked,
      onPress: () => {
        setFlag('programming_peeked');
        router.push('/programming' as never);
      },
    },
    {
      key: 'log',
      label: 'Log your first result',
      description: 'Record a workout or a past PR — your training history is yours.',
      icon: 'stats-chart-outline',
      done: (workouts.data ?? 0) > 0,
      onPress: () => router.push('/track' as never),
    },
    {
      key: 'injury',
      label: 'Note any injuries',
      description: 'Tell us what to work around so coaches can scale movements for you.',
      icon: 'medkit-outline',
      optional: true,
      done: (injuries.data?.length ?? 0) > 0 || !!flags.data?.injury_answered,
      onPress: () => router.push('/injury-check' as never),
    },
  ];

  const requiredSteps = steps.filter((s) => !s.optional);
  const requiredDone = requiredSteps.filter((s) => s.done).length;
  if (requiredDone === requiredSteps.length) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary/30">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={22} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Get the most out of {membership.gymName}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {requiredDone} of {requiredSteps.length} done
          </Text>
        </View>
        <Pressable
          onPress={() => setFlag('getstarted_dismissed')}
          hitSlop={8}
          accessibilityLabel="Dismiss get-started tips"
          className="w-7 h-7 items-center justify-center active:opacity-60">
          <Ionicons name="close" size={18} color="#9CA3AF" />
        </Pressable>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9CA3AF"
        />
      </Pressable>

      <View className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <View
          style={{ width: `${(requiredDone / requiredSteps.length) * 100}%` }}
          className="h-full bg-primary rounded-full"
        />
      </View>

      {open ? (
        <View className="gap-1.5">
          {steps.map((step) => (
            <Pressable
              key={step.key}
              onPress={step.onPress}
              className={`flex-row items-center gap-3 rounded-lg px-3 py-2.5 active:opacity-70 ${
                step.done
                  ? 'bg-gray-50 dark:bg-gray-800/40'
                  : 'bg-gray-50 dark:bg-gray-800'
              }`}>
              <StatusDisk
                size={28}
                done={step.done}
                partial={false}
                complete={step.done ? 1 : 0}
                target={1}
                icon={step.icon}
                accent={colors.primary}
              />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    className={`text-sm font-medium ${
                      step.done
                        ? 'text-gray-400 dark:text-gray-500 line-through'
                        : 'text-gray-900 dark:text-gray-50'
                    }`}>
                    {step.label}
                  </Text>
                  {step.optional && !step.done ? (
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      Optional
                    </Text>
                  ) : null}
                </View>
                {!step.done ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {step.description}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={step.done ? '#6B7280' : '#9CA3AF'}
              />
            </Pressable>
          ))}

          <Pressable
            onPress={() => setFlag('getstarted_dismissed')}
            hitSlop={6}
            className="items-center py-2 active:opacity-60">
            <Text className="text-gray-400 dark:text-gray-500 text-xs font-medium">
              Skip for now
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
