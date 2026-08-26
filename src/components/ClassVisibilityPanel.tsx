// The one thing a gym gets to choose about how full its classes look.
// Sits beside the leaderboard switches because it is the same kind of
// decision — what the gym publishes about its members — and it is the
// owner's, not a capability, like every other gym rule.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, View } from 'react-native';

import { SettingCard } from './SettingCard';
import { Text } from './Text';

import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export function ClassVisibilityPanel() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const isOwner = membership?.role === 'owner';

  const cfg = useQuery({
    queryKey: ['gym-capacity-visibility', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('show_class_capacity')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return (data as { show_class_capacity: boolean }).show_class_capacity;
    },
  });

  const save = useMutation({
    mutationFn: async (next: boolean) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_class_capacity_visibility', {
        p_gym_id: membership.gymId,
        p_value: next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-capacity-visibility'] });
      queryClient.invalidateQueries({ queryKey: ['agenda-spot-counts'] });
      queryClient.invalidateQueries({ queryKey: ['class-spot-counts'] });
    },
  });

  if (!isOwner) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only the owner can change what members see.
      </Text>
    );
  }

  const value = cfg.data ?? true;

  return (
    <View className="gap-3">
      <SettingCard
        title="Show how full a class is"
        description="Members see how many spots are left, and how many are waiting for a full class. Turn it off and they only see whether they can book."
        control={
          <Switch
            accessibilityLabel="Show how full a class is"
            value={value}
            onValueChange={() => save.mutate(!value)}
            disabled={save.isPending}
          />
        }
      />

      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Whether a class is full is always shown — hiding that would offer a
        booking the gym then has to refuse. Coaches and staff always see the
        numbers.
      </Text>

      {save.isError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">
          {errorMessage(save.error, 'Could not save')}
        </Text>
      ) : null}
    </View>
  );
}
