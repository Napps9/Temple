import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

import { Ionicons } from '@expo/vector-icons';

type Cfg = { dm_scope: 'full_gym' | 'member_coach_only' };

const OPTIONS: { key: Cfg['dm_scope']; label: string; blurb: string }[] = [
  {
    key: 'full_gym',
    label: 'Anyone in the gym',
    blurb: 'Any member can DM any other member, coach, admin, or owner.',
  },
  {
    key: 'member_coach_only',
    label: 'Members can only DM staff',
    blurb:
      'Members can DM anyone on the team — staff, coaches, admins, the owner — and reply to them. Only member-to-member DMs are blocked.',
  },
];

export function MessagingPanel() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const queryClient = useQueryClient();

  const cfg = useQuery({
    queryKey: ['gym-messaging-cfg', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Cfg> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('dm_scope')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as Cfg;
    },
  });

  const setScope = useMutation({
    mutationFn: async (scope: Cfg['dm_scope']) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_dm_scope', {
        p_gym_id: membership.gymId,
        p_scope: scope,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-messaging-cfg'] });
    },
  });

  const state = cfg.data ?? { dm_scope: 'full_gym' };

  return (
    <View className="gap-3">
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          Direct message scope
        </Text>
        {OPTIONS.map((opt) => {
          const selected = state.dm_scope === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setScope.mutate(opt.key)}
              disabled={setScope.isPending}
              className={`rounded-lg border p-3 flex-row gap-3 items-start active:opacity-70 ${
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? colors.primary : colors.iconTertiary}
              />
              <View className="flex-1">
                <Text
                  className={
                    selected
                      ? 'text-primary font-medium'
                      : 'text-gray-900 dark:text-gray-50 font-medium'
                  }>
                  {opt.label}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {opt.blurb}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {setScope.isError ? (
          <Text className="text-red-500 dark:text-red-400 text-xs">
            {errorMessage(setScope.error, 'Could not save')}
          </Text>
        ) : null}
      </View>

      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        Announcement and class-broadcast posting permissions live in
        {canManageStaff ? ' Team → Configure role permissions.' : ' the role permissions matrix.'}
      </Text>
    </View>
  );
}

export default function MessagingConfig() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Messaging
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Decide who can DM whom inside the gym.
          </Text>
        </View>
        <MessagingPanel />
      </ScrollView>
    </Screen>
  );
}
