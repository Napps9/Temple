import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useGymMembership, useRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

// Compact "you're not done yet" banner that follows the new owner
// around until they've completed every required step. The dedicated
// /onboarding page is where they actually finish the work; this is the
// breadcrumb that gets them back to it if they navigate away.
//
// Required step keys mirror /onboarding's STEPS — kept in sync by
// hand. Self-hides when not an owner or when no required step is
// pending, so it disappears the moment the gym is ready.

const REQUIRED_KEYS = new Set([
  'logo',
  'settings',
  'class_type',
  'schedule',
  'parq',
  'plan',
]);

type ProgressRow = { step_key: string; done: boolean };

export function SetupBanner() {
  const colors = useThemeColors();
  const role = useRole();
  const { data: membership } = useGymMembership();

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

  if (role !== 'owner') return null;
  if (progress.isLoading || !progress.data) return null;

  const requiredRows = progress.data.filter((r) => REQUIRED_KEYS.has(r.step_key));
  const total = requiredRows.length || REQUIRED_KEYS.size;
  const done = requiredRows.filter((r) => r.done).length;
  if (done >= total) return null;

  return (
    <Link href="/onboarding" asChild>
      <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-3 mx-4 mt-3 flex-row items-center gap-3 border border-primary/30 active:opacity-70">
        <View className="w-9 h-9 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={18} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">
            Finish setting up your gym
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {done} of {total} required steps done · tap to continue
          </Text>
        </View>
        <View className="h-1.5 w-16 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <View
            style={{ width: `${(done / total) * 100}%` }}
            className="h-full bg-primary rounded-full"
          />
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </Pressable>
    </Link>
  );
}
