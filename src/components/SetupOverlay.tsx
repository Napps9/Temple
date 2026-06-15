import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useGymBrand } from '@/lib/useGymBrand';
import { useGymMembership, useRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

// Blocking overlay that catches a new owner on every staff page until
// they've finished the required setup or hit Skip. The /onboarding
// page is the URL-addressable version of the same UI; the overlay is
// the forcing function so an owner who clicks "Classes" from the top
// nav doesn't bypass setup by accident.
//
// Visibility rules:
//   - Owner only (member / coach / admin never see it)
//   - Only on the three staff "home" routes — once the owner taps a
//     step the overlay closes and they can complete it; coming back to
//     /classes (or another covered route) re-opens it for the next.
//   - Skip button persists for the browser session via sessionStorage
//     so they're not nagged through the same visit.
//   - Auto-vanishes the moment every required step is done, regardless
//     of the skip flag.

const REQUIRED_KEYS = new Set([
  'logo',
  'settings',
  'class_type',
  'schedule',
  'parq',
  'plan',
]);

const OVERLAY_PATHS = new Set(['/classes', '/programming', '/management']);

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
    description:
      'Upload a waiver or build a PAR-Q — one is enough.',
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
      'Generate an invite code. Skip if you run solo.',
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

type ProgressRow = { step_key: StepKey; done: boolean };

function skipKey(gymId: string): string {
  return `temple-onboarding-skipped:${gymId}`;
}

function readSkipped(gymId: string | null | undefined): boolean {
  if (!gymId || Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage?.getItem(skipKey(gymId)) === '1';
  } catch {
    return false;
  }
}

function writeSkipped(gymId: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem(skipKey(gymId), '1');
  } catch {
    // Storage unavailable (private window, quota, etc.) — overlay just
    // re-opens on next render, which is the safe failure mode.
  }
}

export function SetupOverlay() {
  const pathname = usePathname();
  const colors = useThemeColors();
  const role = useRole();
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();

  // Allow the overlay to re-open after a per-step dismiss when the
  // user lands back on a covered route. Tapping a step calls
  // setLocalClosed(true); the pathname effect resets it. Note: we
  // can't use just sessionStorage for this because we want
  // "navigated away from setup" not "explicit skip" semantics.
  const [localClosed, setLocalClosed] = useState(false);
  useEffect(() => {
    setLocalClosed(false);
  }, [pathname]);

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

  const requiredSteps = status.filter((s) => !s.optional);
  const optionalSteps = status.filter((s) => s.optional);
  const requiredDone = requiredSteps.filter((s) => s.done).length;
  const allRequiredDone =
    requiredSteps.length > 0 && requiredDone === requiredSteps.length;

  const skipped = readSkipped(membership?.gymId);

  const visible =
    role === 'owner' &&
    OVERLAY_PATHS.has(pathname) &&
    !skipped &&
    !localClosed &&
    !!progress.data &&
    !allRequiredDone;

  function onSkip() {
    if (membership?.gymId) writeSkipped(membership.gymId);
    setLocalClosed(true);
  }

  function onStepPress(step: Step) {
    setLocalClosed(true);
    router.push(step.href as never);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSkip}>
      <View className="flex-1 bg-black/60 items-center justify-center px-4">
        <ScrollView
          className="max-h-full w-full"
          contentContainerClassName="py-6 md:py-10"
          showsVerticalScrollIndicator={false}>
          <View className="w-full max-w-2xl mx-auto bg-white dark:bg-gray-950 rounded-3xl p-5 md:p-7 gap-6">
            <View className="flex-row items-start gap-3">
              <View className="w-12 h-12 rounded-2xl bg-primary/15 items-center justify-center">
                <Ionicons name="rocket-outline" size={26} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-primary text-[10px] font-semibold uppercase tracking-widest">
                  Setting up
                </Text>
                <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                  Welcome to {brand.gymName || 'Temple'}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 mt-1">
                  A few quick steps and you'll be running classes. Most owners
                  are up in about 10 minutes.
                </Text>
              </View>
            </View>

            <View className="gap-2">
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
            </View>

            <View className="gap-1.5">
              {requiredSteps.map((step) => (
                <StepRow
                  key={step.key}
                  step={step}
                  accent={colors.primary}
                  onPress={() => onStepPress(step)}
                />
              ))}
            </View>

            {optionalSteps.length > 0 ? (
              <View className="gap-1.5">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest px-1">
                  Optional · do these later
                </Text>
                {optionalSteps.map((step) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    accent={colors.primary}
                    onPress={() => onStepPress(step)}
                  />
                ))}
              </View>
            ) : null}

            <View className="items-center pt-1">
              <Pressable hitSlop={8} onPress={onSkip}>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Skip for now — I'll set this up later
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function StepRow({
  step,
  accent,
  onPress,
}: {
  step: Step & { done: boolean };
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
