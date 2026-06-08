import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, Switch, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Config = {
  class_leaderboards_enabled: boolean;
  strength_leaderboards_enabled: boolean;
};

export default function LeaderboardsConfigPage() {
  const { data: membership } = useGymMembership();
  const canConfigure = useCan('can_configure_leaderboards');
  const queryClient = useQueryClient();

  const cfg = useQuery({
    queryKey: ['gym-leaderboard-cfg', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Config> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('class_leaderboards_enabled, strength_leaderboards_enabled')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as Config;
    },
  });

  const save = useMutation({
    mutationFn: async (next: Config) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_leaderboard_config', {
        p_gym_id: membership.gymId,
        p_class_enabled: next.class_leaderboards_enabled,
        p_strength_enabled: next.strength_leaderboards_enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-leaderboard-cfg'] });
      queryClient.invalidateQueries({ queryKey: ['gym-leaderboard-flags'] });
      queryClient.invalidateQueries({ queryKey: ['class-leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['strength-leaderboard'] });
    },
  });

  if (canConfigure === false) {
    return (
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
          Only the owner can configure leaderboards.
        </Text>
      </Screen>
    );
  }

  const state = cfg.data ?? {
    class_leaderboards_enabled: true,
    strength_leaderboards_enabled: true,
  };

  function flip(field: keyof Config) {
    save.mutate({ ...state, [field]: !state[field] });
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Leaderboards
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Decide which kinds of comparison your members see.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Class leaderboards
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Rank members on programmed sections (Tuesday's Fran, the
                strength session, …). Coaches pick per section.
              </Text>
            </View>
            <Switch
              value={state.class_leaderboards_enabled}
              onValueChange={() => flip('class_leaderboards_enabled')}
              disabled={save.isPending}
            />
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Strength leaderboards
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Rank members on movement PRs (heaviest Back Squat 1RM, fastest
                5K, …) across the gym.
              </Text>
            </View>
            <Switch
              value={state.strength_leaderboards_enabled}
              onValueChange={() => flip('strength_leaderboards_enabled')}
              disabled={save.isPending}
            />
          </View>
        </View>

        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Members can hide themselves from leaderboards on their own account
          screen.
        </Text>

        {save.isError ? (
          <Text className="text-red-500 dark:text-red-400 text-xs">
            {errorMessage(save.error, 'Could not save')}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
