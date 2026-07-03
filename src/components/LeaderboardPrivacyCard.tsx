import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, Text, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Lets the member opt out of leaderboards. Default is opt-out (true)
// so the toggle starts on for everyone — flipping it off hides them
// from both class and strength rankings (they still see their own
// data everywhere else).
export function LeaderboardPrivacyCard() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: [
      'appear-in-leaderboards',
      membership?.gymId,
      session?.user.id,
    ],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('appear_in_leaderboards')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', session!.user.id)
        .single();
      if (error) throw error;
      return data.appear_in_leaderboards;
    },
  });

  const flip = useMutation({
    mutationFn: async (next: boolean) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_appear_in_leaderboards', {
        p_gym_id: membership.gymId,
        p_value: next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appear-in-leaderboards'] });
      queryClient.invalidateQueries({ queryKey: ['class-leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['strength-leaderboard'] });
    },
  });

  const value = state.data ?? true;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Show me on leaderboards
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Compare your scores with other gym members on class WODs and
            strength PRs.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Show me on leaderboards"
          value={value}
          onValueChange={(v) => flip.mutate(v)}
          disabled={state.isLoading || flip.isPending}
        />
      </View>
    </View>
  );
}
