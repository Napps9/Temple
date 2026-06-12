import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useGymMembership, useRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Setup checklist shown to the gym owner on the Manage home page while
// the gym is still being stood up. Each step is derived from a
// concrete query against the live data — when the owner uploads a
// logo / publishes PAR-Q / adds a plan, the matching step flips done.
// The whole card disappears once every *required* step is complete so
// it never nags a finished gym; the team-invite step is optional so a
// solo coach isn't kept in the nag state.
//
// Admin can finish the non-plan steps but not plans
// (`can_manage_plans` is owner-only by default), so the checklist is
// owner-only by role to avoid showing an admin a task they can't
// complete.

type Step = {
  key: 'logo' | 'class_type' | 'schedule' | 'parq' | 'plan' | 'team';
  label: string;
  description: string;
  href: string;
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
    href: '/management/branding',
    icon: 'image-outline',
  },
  {
    key: 'class_type',
    label: 'Add a class type',
    description:
      'Name the kinds of class you run (CrossFit, Hyrox, mobility…) and pick a colour.',
    href: '/management/class-types',
    icon: 'pricetags-outline',
  },
  {
    key: 'schedule',
    label: 'Set up a class schedule',
    description:
      'Recurring days + times turn your class types into actual sessions on the calendar.',
    href: '/management/class-types',
    icon: 'calendar-outline',
  },
  {
    key: 'parq',
    label: 'Set up health screening',
    description:
      'Upload a waiver to sign or build a PAR-Q — one is enough. Until you do, the booking safety gate is off.',
    href: '/management/parq',
    icon: 'medkit-outline',
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
      'Generate an invite code for an admin, coach or member of staff. Skip if you run solo.',
    href: '/management/team',
    icon: 'people-outline',
    optional: true,
  },
];

type ProgressRow = { step_key: Step['key']; done: boolean };

export function GymSetupChecklist() {
  const { data: membership } = useGymMembership();
  const role = useRole();

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
    const map = new Map<Step['key'], boolean>();
    for (const row of progress.data ?? []) map.set(row.step_key, row.done);
    return STEPS.map((s) => ({ ...s, done: map.get(s.key) ?? false }));
  }, [progress.data]);

  if (role !== 'owner') return null;
  if (progress.isLoading || !progress.data) return null;
  const requiredSteps = STEPS.filter((s) => !s.optional);
  const requiredDone = status.filter((s) => !s.optional && s.done).length;
  if (requiredDone === requiredSteps.length) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary/30">
      <View className="flex-row items-center gap-3">
        <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={22} color="#2563EB" />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Get your gym ready
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {requiredDone} of {requiredSteps.length} done
          </Text>
        </View>
      </View>

      {/* Progress bar tracks the required steps so the bar fills 100%
          even if the optional team step is still untouched. */}
      <View className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <View
          style={{ width: `${(requiredDone / requiredSteps.length) * 100}%` }}
          className="h-full bg-primary rounded-full"
        />
      </View>

      <View className="gap-1.5">
        {status.map((step) => (
          <Pressable
            key={step.key}
            onPress={() => router.push(step.href as never)}
            disabled={step.done}
            className={`flex-row items-center gap-3 rounded-lg px-3 py-2.5 ${
              step.done
                ? 'bg-gray-50 dark:bg-gray-800/40'
                : 'bg-gray-50 dark:bg-gray-800 active:opacity-70'
            }`}>
            <View
              className={`w-7 h-7 rounded-full items-center justify-center ${
                step.done
                  ? 'bg-emerald-500/15'
                  : 'bg-primary/10'
              }`}>
              <Ionicons
                name={step.done ? 'checkmark' : step.icon}
                size={15}
                color={step.done ? '#10B981' : '#2563EB'}
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
            {!step.done ? (
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
