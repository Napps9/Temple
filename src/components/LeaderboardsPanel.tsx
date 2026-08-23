// Lives here rather than under app/ because it has no route of its own.
// /management/leaderboards was a Screen, a BackLink and a heading wrapped
// around this panel, and the Manage screen's Settings tab already rendered
// the same component behind the same capability — two doors into one
// surface, one of which nothing in the app linked to.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, View } from 'react-native';

import { SettingCard } from './SettingCard';
import { Text } from './Text';

import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Config = {
  class_leaderboards_enabled: boolean;
  strength_leaderboards_enabled: boolean;
};

export function LeaderboardsPanel() {
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
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only the owner can configure leaderboards.
      </Text>
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
    <View className="gap-3">
      <SettingCard
        title="Class leaderboards"
        description="Rank members on programmed sections (Tuesday's Fran, the strength session, …). Coaches pick per section."
        control={
          <Switch
            accessibilityLabel="Class leaderboards"
            value={state.class_leaderboards_enabled}
            onValueChange={() => flip('class_leaderboards_enabled')}
            disabled={save.isPending}
          />
        }
      />

      <SettingCard
        title="Strength leaderboards"
        description="Rank members on movement PRs (heaviest Back Squat 1RM, fastest 5K, …) across the gym."
        control={
          <Switch
            accessibilityLabel="Strength leaderboards"
            value={state.strength_leaderboards_enabled}
            onValueChange={() => flip('strength_leaderboards_enabled')}
            disabled={save.isPending}
          />
        }
      />

      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Members can hide themselves from leaderboards on their own account
        screen.
      </Text>

      {save.isError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">
          {errorMessage(save.error, 'Could not save')}
        </Text>
      ) : null}
    </View>
  );
}
