import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Spinner } from '@/components/EmptyState';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { StatusDisk } from '@/components/StatusDisk';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import type { SettingsSectionId } from '@/lib/back-office';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';

// Dedicated, navless onboarding screen. Sits at the top level (not
// inside the (staff) group) so the staff TopNav doesn't render —
// the only ways out are Skip, completing setup, or hitting back.
//
// Routing: src/app/index.tsx sends owners with incomplete setup here
// unless they've dismissed it (gyms.onboarding_dismissed_at). Once
// Skip is set, root redirects them to /classes instead — for good,
// not just this session; the steps are still reachable from Manage.

type StepKey =
  | 'logo'
  | 'settings'
  | 'class_type_and_schedule'
  | 'parq'
  | 'stripe'
  | 'plan'
  | 'team'
  | 'members_imported'
  | 'workouts_imported';

type Step = {
  key: StepKey;
  label: string;
  description: string;
  // A route, or a section of the Manage screen for the four steps whose
  // routes were retired into it. Exactly one of the two.
  href?: string;
  section?: SettingsSectionId;
  icon: keyof typeof Ionicons.glyphMap;
  optional?: boolean;
  estimate: string;
};

// This checklist is its own full-screen surface, so a section step really
// does navigate — and ?section= is how it says which one. ?backTo keeps
// the bounce: the Manage screen runs the auto-return hook for the step the
// section completes, so a finished step still returns the owner here.
function stepHref(step: Step): string {
  return step.section
    ? `/management?section=${step.section}&backTo=checklist`
    : `${step.href}?backTo=checklist`;
}

const STEPS: Step[] = [
  {
    key: 'logo',
    label: 'Add your gym logo',
    description: 'A logo makes the app feel like your gym, not a template.',
    section: 'branding',
    icon: 'image-outline',
    estimate: '1 min',
  },
  {
    key: 'settings',
    label: 'Set your gym settings',
    description:
      'Week start, class defaults, booking windows. Save once to lock them in.',
    section: 'gym-settings',
    icon: 'settings-outline',
    estimate: '2 min',
  },
  {
    key: 'class_type_and_schedule',
    label: 'Add a class type & schedule',
    description:
      'Name the kinds of class you run (CrossFit, Hyrox, mobility…) and set the recurring days + times so they appear on the calendar.',
    section: 'class-types',
    icon: 'pricetags-outline',
    estimate: '3 min',
  },
  {
    key: 'parq',
    label: 'Set up health screening',
    description: 'Upload a waiver or build a PAR-Q — one is enough.',
    section: 'health-screening',
    icon: 'medkit-outline',
    estimate: '2 min',
  },
  {
    key: 'stripe',
    label: 'Connect payments',
    description:
      'Connect Stripe so members can pay you — your own account, Temple takes no cut. Needed before you can sell a plan.',
    href: '/management/billing',
    icon: 'wallet-outline',
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
    description: 'Email your coaches an invite. Skip if you run solo.',
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

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const session = useSession();
  const role = useRole();
  const { data: membership, isLoading: membershipLoading } = useGymMembership();
  const brand = useGymBrand();
  const queryClient = useQueryClient();

  const dismiss = useMutation({
    mutationFn: async () => {
      if (!membership?.gymId) return;
      const { error } = await supabase.rpc('dismiss_gym_onboarding', {
        p_gym_id: membership.gymId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-onboarding-dismissed'] });
      router.replace('/classes' as never);
    },
    onError: () => {
      // Dismissal failed to save — still let them through this visit
      // rather than trap them here, but they'll see the screen again
      // next sign-in since the flag never got stamped server-side.
      router.replace('/classes' as never);
    },
  });

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
              <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
                {allRequiredDone
                  ? "You're all set"
                  : `Welcome to ${brand.gymName || 'Temple'}`}
              </Text>
            </View>
          </View>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            {allRequiredDone
              ? "Your gym is ready for members. The optional steps below seed history and team — you can come back to them anytime from Manage."
              : "A few quick steps and you'll be running classes, taking bookings and tracking members. Most owners are up in about 10 minutes."}
          </Text>
        </View>

        <View className="bg-surface dark:bg-surface-dk rounded-2xl p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              {requiredDone} of {requiredSteps.length} done
            </Text>
            <FieldLabel>
              Required
            </FieldLabel>
          </View>
          <View className="h-2 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
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
            <SectionLabel>
              Optional · do these later
            </SectionLabel>
            <View className="bg-surface dark:bg-surface-dk rounded-2xl p-4 gap-2">
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
              disabled={dismiss.isPending}
              onPress={() => dismiss.mutate()}>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                {dismiss.isPending
                  ? 'Saving…'
                  : "Don't show this again — I'll finish setup from Manage"}
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
    <View className="flex-1 bg-ground dark:bg-ground-dk items-center justify-center">
      <Spinner />
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
  const colors = useThemeColors();
  const partial = !step.done && step.complete > 0 && step.complete < step.target;
  return (
    <Pressable
      onPress={() => router.push(stepHref(step) as never)}
      className={`flex-row items-center gap-3 rounded-xl px-3 py-3 active:opacity-70 ${
        step.done ? 'bg-raised dark:bg-raised-dk/40' : 'bg-raised dark:bg-raised-dk'
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
                ? 'text-ink-3 dark:text-ink-3-dk line-through'
                : 'text-ink dark:text-ink-dk'
            }`}>
            {step.label}
          </Text>
          {!step.done ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-mono">
              ~{step.estimate}
              {step.target > 1 ? ` · ${step.complete}/${step.target}` : ''}
            </Text>
          ) : null}
        </View>
        {!step.done ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {step.description}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={15}
        color={step.done ? colors.ink2 : colors.ink3}
      />
    </Pressable>
  );
}
