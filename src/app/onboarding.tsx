import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { StatusDisk } from '@/components/StatusDisk';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';

// Dedicated, navless onboarding screen. Sits at the top level (not
// inside the (staff) group) so the staff TopNav doesn't render —
// the only ways out are Skip, completing setup, or hitting back.
//
// Routing: src/app/index.tsx sends owners with incomplete setup here
// unless they've hit Skip this session (per-gym sessionStorage flag).
// Once Skip is set, root redirects them to /classes instead so they
// can explore freely without being nagged again until next sign-in.

type StepKey =
  | 'logo'
  | 'settings'
  | 'class_type'
  | 'schedule'
  | 'parq'
  | 'plan'
  | 'team'
  | 'members_imported'
  | 'workouts_imported';

type Step = {
  key: StepKey;
  label: string;
  description: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  optional?: boolean;
  estimate: string;
};

const STEPS: Step[] = [
  {
    key: 'logo',
    label: 'Add your gym logo',
    description: 'A logo makes the app feel like your gym, not a template.',
    href: '/management/branding',
    icon: 'image-outline',
    estimate: '1 min',
  },
  {
    key: 'settings',
    label: 'Set your gym settings',
    description:
      'Week start, class defaults, booking windows. Save once to lock them in.',
    href: '/management/operating',
    icon: 'settings-outline',
    estimate: '2 min',
  },
  {
    key: 'class_type',
    label: 'Add a class type',
    description:
      'Name the kinds of class you run (CrossFit, Hyrox, mobility…) and pick a colour.',
    href: '/management/class-types',
    icon: 'pricetags-outline',
    estimate: '1 min',
  },
  {
    key: 'schedule',
    label: 'Set up a class schedule',
    description:
      'Recurring days + times turn your class types into actual sessions.',
    href: '/management/class-types',
    icon: 'calendar-outline',
    estimate: '2 min',
  },
  {
    key: 'parq',
    label: 'Set up health screening',
    description: 'Upload a waiver or build a PAR-Q — one is enough.',
    href: '/management/parq',
    icon: 'medkit-outline',
    estimate: '2 min',
  },
  {
    key: 'plan',
    label: 'Create a membership plan',
    description:
      'Unlimited, credit pack or credit period — at least one so members can subscribe.',
    href: '/management/plans',
    icon: 'card-outline',
    estimate: '2 min',
  },
  {
    key: 'team',
    label: 'Invite your team',
    description: 'Generate an invite code. Skip if you run solo.',
    href: '/management/team',
    icon: 'people-outline',
    optional: true,
    estimate: '1 min',
  },
  {
    key: 'members_imported',
    label: 'Bring your members across',
    description: 'Import a CSV from your previous platform.',
    href: '/management/members/import',
    icon: 'cloud-upload-outline',
    optional: true,
    estimate: '3 min',
  },
  {
    key: 'workouts_imported',
    label: 'Import workout history',
    description: 'Seed past sets so /track and PR pages are populated.',
    href: '/management/members/import-workouts',
    icon: 'stats-chart-outline',
    optional: true,
    estimate: '3 min',
  },
];

type ProgressRow = {
  step_key: StepKey;
  done: boolean;
  complete: number;
  target: number;
};

function skipKey(gymId: string): string {
  return `temple-onboarding-skipped:${gymId}`;
}

function writeSkipped(gymId: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem(skipKey(gymId), '1');
  } catch {
    /* storage unavailable — Skip still navigates */
  }
}

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const session = useSession();
  const role = useRole();
  const { data: membership, isLoading: membershipLoading } = useGymMembership();
  const brand = useGymBrand();

  const progress = useQuery({
    queryKey: ['gym-setup-progress', membership?.gymId],
    enabled: !!membership?.gymId && role === 'owner',
    queryFn: async (): Promise<ProgressRow[]> => {
      const { data, error } = await supabase.rpc('get_gym_setup_progress', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as ProgressRow[];
    },
  });

  const status = useMemo(() => {
    const map = new Map<StepKey, ProgressRow>();
    for (const row of progress.data ?? []) map.set(row.step_key, row);
    return STEPS.map((s) => {
      const row = map.get(s.key);
      return {
        ...s,
        done: row?.done ?? false,
        complete: row?.complete ?? 0,
        target: row?.target ?? 1,
      };
    });
  }, [progress.data]);

  // Guards live in the page itself since /onboarding sits outside the
  // (staff) group.
  if (session === undefined) return <Loading />;
  if (session === null) return <Redirect href="/sign-in" />;
  if (membershipLoading) return <Loading />;
  if (!membership) return <Redirect href="/athlete" />;
  if (role !== null && role !== 'owner') return <Redirect href="/classes" />;
  if (progress.isLoading || !progress.data) return <Loading />;

  const requiredSteps = status.filter((s) => !s.optional);
  const optionalSteps = status.filter((s) => s.optional);
  const requiredDone = requiredSteps.filter((s) => s.done).length;
  const allRequiredDone = requiredDone === requiredSteps.length;

  function onSkip() {
    if (membership?.gymId) writeSkipped(membership.gymId);
    router.replace('/classes' as never);
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-8 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-3">
          <View className="flex-row items-start gap-3">
            <View className="w-12 h-12 rounded-2xl bg-primary/15 items-center justify-center">
              <Ionicons name="rocket-outline" size={26} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-primary text-[10px] font-semibold uppercase tracking-widest">
                Setting up
              </Text>
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                {allRequiredDone
                  ? "You're all set"
                  : `Welcome to ${brand.gymName || 'Temple'}`}
              </Text>
            </View>
          </View>
          <Text className="text-gray-500 dark:text-gray-400">
            {allRequiredDone
              ? "Your gym is ready for members. The optional steps below seed history and team — you can come back to them anytime from Manage."
              : "A few quick steps and you'll be running classes, taking bookings and tracking members. Most owners are up in about 10 minutes."}
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              {requiredDone} of {requiredSteps.length} done
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Required
            </Text>
          </View>
          <View className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <View
              style={{
                width: `${(requiredDone / Math.max(1, requiredSteps.length)) * 100}%`,
              }}
              className="h-full bg-primary rounded-full"
            />
          </View>
          <View className="gap-2">
            {requiredSteps.map((step) => (
              <StepRow key={step.key} step={step} accent={colors.primary} />
            ))}
          </View>
        </View>

        {optionalSteps.length > 0 ? (
          <View className="gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest px-1">
              Optional · do these later
            </Text>
            <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-2">
              {optionalSteps.map((step) => (
                <StepRow key={step.key} step={step} accent={colors.primary} />
              ))}
            </View>
          </View>
        ) : null}

        {allRequiredDone ? (
          <Button onPress={() => router.replace('/classes' as never)}>
            Take me to my gym
          </Button>
        ) : (
          <View className="items-center pt-2">
            <Pressable hitSlop={8} onPress={onSkip}>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Skip for now — I'll set this up later
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Loading() {
  return (
    <View className="flex-1 bg-slate-100 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}

function StepRow({
  step,
  accent,
}: {
  step: Step & { done: boolean; complete: number; target: number };
  accent: string;
}) {
  const partial = !step.done && step.complete > 0 && step.complete < step.target;
  return (
    <Pressable
      onPress={() => router.push(step.href as never)}
      className={`flex-row items-center gap-3 rounded-xl px-3 py-3 active:opacity-70 ${
        step.done ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-gray-50 dark:bg-gray-800'
      }`}>
      {/* Status disk: solid emerald + bold tick when fully done, a
          partial-fill ring when some but not all sub-items are
          satisfied, an empty primary-outlined circle with the step
          icon otherwise. */}
      <StatusDisk
        size={36}
        done={step.done}
        partial={partial}
        complete={step.complete}
        target={step.target}
        icon={step.icon}
        accent={accent}
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
          {!step.done ? (
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">
              ~{step.estimate}
              {step.target > 1 ? ` · ${step.complete}/${step.target}` : ''}
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
  );
}
