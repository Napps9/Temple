import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { StatusDisk } from '@/components/StatusDisk';
import { useGymMembership, useRole } from '@/lib/auth';
import type { SettingsSectionId } from '@/lib/back-office';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

// Setup checklist shown to the gym owner on the Manage home page while
// the gym is still being stood up. Each step is derived from a
// concrete query against the live data — when the owner uploads a
// logo / publishes PAR-Q / adds a plan, the matching step flips done.
// The card stays put until every step (required and optional) is done,
// or the owner dismisses it — both surfaces share the
// onboarding_dismissed_at flag — so setup is always one place away and
// the optional steps don't vanish the moment the required ones finish.
//
// Admin can finish the non-plan steps but not plans
// (`can_manage_plans` is owner-only by default), so the checklist is
// owner-only by role to avoid showing an admin a task they can't
// complete.

type Step = {
  key:
    | 'logo'
    | 'settings'
    | 'class_type_and_schedule'
    | 'parq'
    | 'stripe'
    | 'plan'
    | 'team'
    | 'members_imported'
    | 'workouts_imported';
  label: string;
  description: string;
  // A route, or a section of the Manage screen for the four steps whose
  // routes were retired into it. Exactly one of the two.
  href?: string;
  section?: SettingsSectionId;
  icon: keyof typeof Ionicons.glyphMap;
  // Optional steps don't keep the card alive — once every required
  // step is done the whole thing vanishes regardless of optionals.
  optional?: boolean;
};

const STEPS: Step[] = [
  {
    key: 'logo',
    label: 'Add your gym logo',
    description: 'A logo makes the app feel like your gym, not a template.',
    section: 'branding',
    icon: 'image-outline',
  },
  {
    key: 'settings',
    label: 'Set your gym settings',
    description:
      'Week start, class defaults, booking and cancellation windows, plan resolution. Open and save once to lock them in.',
    section: 'gym-settings',
    icon: 'settings-outline',
  },
  {
    key: 'class_type_and_schedule',
    label: 'Add a class type & schedule',
    description:
      'Name the kinds of class you run and set the recurring days + times so they appear on the calendar.',
    section: 'class-types',
    icon: 'pricetags-outline',
  },
  {
    key: 'parq',
    label: 'Set up health screening',
    description:
      'Upload a waiver to sign or build a PAR-Q — one is enough. Until you do, the booking safety gate is off.',
    section: 'health-screening',
    icon: 'medkit-outline',
  },
  {
    key: 'stripe',
    label: 'Connect payments',
    description:
      'Connect Stripe so members can pay you — your own account, Temple takes no cut. Needed before you can sell a plan.',
    href: '/management/billing',
    icon: 'wallet-outline',
  },
  {
    key: 'plan',
    label: 'Create a membership plan',
    description: 'Unlimited, credit pack, or credit period — at least one so members can subscribe.',
    href: '/management/plans',
    icon: 'card-outline',
  },
  {
    key: 'team',
    label: 'Invite your team',
    description:
      'Email an invite to an admin, coach or member of staff. Skip if you run solo.',
    href: '/management/team',
    icon: 'people-outline',
    optional: true,
  },
  {
    key: 'members_imported',
    label: 'Bring your members across',
    description:
      'Import a CSV from your previous platform. Members link to their data when they sign up at your join link.',
    href: '/management/members/import',
    icon: 'cloud-upload-outline',
    optional: true,
  },
  {
    key: 'workouts_imported',
    label: 'Import workout history',
    description:
      'Seed past sets so members log in to a populated /track and PR pages — sparklines and trends light up from day one.',
    href: '/management/members/import-workouts',
    icon: 'stats-chart-outline',
    optional: true,
  },
];

type ProgressRow = {
  step_key: Step['key'];
  done: boolean;
  complete: number;
  target: number;
};

// Collapsed on a fresh app start so the nudge sits quietly; once the owner
// opens it we keep it open across navigation (module scope, session-only,
// like list-scroll-position). Tapping a step that still has a route
// deep-links with ?backTo=checklist so its BackLink returns to the
// full-screen /onboarding checklist rather than dropping the owner on
// Manage — the two setup surfaces stay in sync.
let checklistOpen = false;

// This card only ever renders on the Manage screen, so a step whose
// surface is a section of that screen opens it in place rather than
// navigating to the screen it is already on.
export function GymSetupChecklist({
  onOpenSection,
}: {
  onOpenSection: (id: SettingsSectionId) => void;
}) {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const [open, setOpenState] = useState(checklistOpen);
  const setOpen = (next: boolean) => {
    checklistOpen = next;
    setOpenState(next);
  };

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

  const queryClient = useQueryClient();
  const dismissed = useQuery({
    queryKey: ['gym-onboarding-dismissed', membership?.gymId],
    enabled: !!membership?.gymId && role === 'owner',
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('onboarding_dismissed_at')
        .eq('id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return !!data?.onboarding_dismissed_at;
    },
  });
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
    },
  });

  const status = useMemo(() => {
    const map = new Map<Step['key'], ProgressRow>();
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

  if (role !== 'owner') return null;
  if (progress.isLoading || !progress.data) return null;
  if (dismissed.data) return null;
  const requiredSteps = STEPS.filter((s) => !s.optional);
  const requiredDone = status.filter((s) => !s.optional && s.done).length;
  const requiredComplete = requiredDone === requiredSteps.length;
  // Stay until genuinely finished (required + optional) or dismissed.
  if (status.every((s) => s.done)) return null;

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 border border-primary/30">
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={22} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Get your gym ready
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {requiredComplete
              ? 'You’re all set — optional extras below'
              : `${requiredDone} of ${requiredSteps.length} done`}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.ink3}
        />
      </Pressable>

      {/* Progress bar tracks the required steps so the bar fills 100%
          even if the optional team step is still untouched. */}
      <View className="h-2 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
        <View
          style={{ width: `${(requiredDone / requiredSteps.length) * 100}%` }}
          className="h-full bg-primary rounded-full"
        />
      </View>

      {open ? (
      <View className="gap-1.5">
        {status.map((step) => (
          <Pressable
            key={step.key}
            onPress={() =>
              step.section
                ? onOpenSection(step.section)
                : router.push(`${step.href}?backTo=checklist` as never)
            }
            className={`flex-row items-center gap-3 rounded-lg px-3 py-2.5 active:opacity-70 ${
              step.done
                ? 'bg-raised dark:bg-raised-dk/40'
                : 'bg-raised dark:bg-raised-dk'
            }`}>
            <StatusDisk
              size={28}
              done={step.done}
              partial={
                !step.done && step.complete > 0 && step.complete < step.target
              }
              complete={step.complete}
              target={step.target}
              icon={step.icon}
              accent={colors.primary}
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
                {step.optional && !step.done ? (
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 dark:text-ink-3-dk bg-sunken dark:bg-sunken-dk px-1.5 py-0.5 rounded">
                    Optional
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
        ))}
        {/* The two setup surfaces point at each other. Without this the
            list only ever leads down into Manage pages, and an owner who
            started in the conversation has no way back to it from here. */}
        <Pressable
          onPress={() => router.replace('/setup' as never)}
          hitSlop={8}
          className="self-center pt-1 active:opacity-70">
          <Text className="text-link text-xs font-medium">
            Rather be walked through it?
          </Text>
        </Pressable>
        <Pressable
          onPress={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          hitSlop={8}
          className="self-center active:opacity-70">
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            {dismiss.isPending ? 'Hiding…' : 'I’ll finish setup later'}
          </Text>
        </Pressable>
      </View>
      ) : null}
    </View>
  );
}
