import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';

// Focused first-run experience for a brand-new owner. The same
// get_gym_setup_progress data the /management checklist consumes, but
// laid out big and centred so a new owner's first read is "here's what
// I need to do" — not a calendar full of empty 5am slots.
//
// Routing: src/app/index.tsx sends an owner with any required step
// still pending here. Returning owners with everything done go straight
// to /classes — no extra redirect hop. The "Skip for now" link is the
// honest escape hatch; the checklist also lives on /management for
// re-entry.

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

// Same set + order as GymSetupChecklist, plus an estimated time on
// each step so the "10 minutes" pitch is grounded.
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
      'Week start, class defaults, booking windows. Open and save once to lock them in.',
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
      'Recurring days + times turn your class types into actual sessions on the calendar.',
    href: '/management/class-types',
    icon: 'calendar-outline',
    estimate: '2 min',
  },
  {
    key: 'parq',
    label: 'Set up health screening',
    description:
      'Upload a waiver or build a PAR-Q — one is enough to satisfy the booking safety gate.',
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
    description:
      'Generate an invite code for an admin, coach or member of staff. Skip if you run solo.',
    href: '/management/team',
    icon: 'people-outline',
    optional: true,
    estimate: '1 min',
  },
  {
    key: 'members_imported',
    label: 'Bring your members across',
    description:
      'Import a CSV from your previous platform. Members link to their data when they sign up.',
    href: '/management/members/import',
    icon: 'cloud-upload-outline',
    optional: true,
    estimate: '3 min',
  },
  {
    key: 'workouts_imported',
    label: 'Import workout history',
    description:
      'Seed past sets so /track and PR pages are populated from day one.',
    href: '/management/members/import-workouts',
    icon: 'stats-chart-outline',
    optional: true,
    estimate: '3 min',
  },
];

type ProgressRow = { step_key: StepKey; done: boolean };

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const role = useRole();
  const { data: membership } = useGymMembership();
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
    const map = new Map<StepKey, boolean>();
    for (const row of progress.data ?? []) map.set(row.step_key, row.done);
    return STEPS.map((s) => ({ ...s, done: map.get(s.key) ?? false }));
  }, [progress.data]);

  // Owners only. Non-owners shouldn't see the setup surface and shouldn't
  // be able to deep-link to it.
  if (role !== undefined && role !== 'owner') {
    return <Redirect href="/classes" />;
  }
  if (role === undefined || progress.isLoading || !progress.data) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const requiredSteps = status.filter((s) => !s.optional);
  const optionalSteps = status.filter((s) => s.optional);
  const requiredDone = requiredSteps.filter((s) => s.done).length;
  const allRequiredDone = requiredDone === requiredSteps.length;

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-8 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-3">
          <View className="flex-row items-center gap-3">
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
              style={{ width: `${(requiredDone / requiredSteps.length) * 100}%` }}
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
            <Pressable
              hitSlop={8}
              onPress={() => router.replace('/classes' as never)}>
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

function StepRow({
  step,
  accent,
}: {
  step: Step & { done: boolean };
  accent: string;
}) {
  return (
    <Pressable
      onPress={() => router.push(step.href as never)}
      className={`flex-row items-center gap-3 rounded-xl px-3 py-3 active:opacity-70 ${
        step.done ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-gray-50 dark:bg-gray-800'
      }`}>
      <View
        className={`w-9 h-9 rounded-xl items-center justify-center ${
          step.done ? 'bg-emerald-500/15' : 'bg-primary/10'
        }`}>
        <Ionicons
          name={step.done ? 'checkmark' : step.icon}
          size={18}
          color={step.done ? '#10B981' : accent}
        />
      </View>
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
