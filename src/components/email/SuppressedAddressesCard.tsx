import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Addresses the gym's mail cannot reach (0229). Deliberately a separate
// list from unsubscribes: an unsubscribe is a member's decision and is not
// the gym's to reverse, while a suppression is usually a typo or a closed
// work address and clearing it is exactly what an owner should be able to
// do once it is fixed.
export function SuppressedAddressesCard() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId ?? null;
  const queryClient = useQueryClient();

  const rows = useQuery({
    queryKey: ['comms-suppressions', gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_suppressions')
        .select('id, email, reason, detail, last_seen_at')
        .eq('gym_id', gymId!)
        .order('last_seen_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clear = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('email_suppressions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['comms-suppressions', gymId] }),
  });

  if (rows.isLoading) {
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
        <ActivityIndicator />
      </View>
    );
  }
  if ((rows.data ?? []).length === 0) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        Addresses we can no longer reach
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        Mail to these came back permanently, or the person marked it as spam.
        They are held back from every send until you clear them — which is
        worth doing for a typo that has since been corrected, and worth
        leaving alone for a spam report.
      </Text>
      {clear.isError ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(clear.error, 'Could not clear that address')}
        </Text>
      ) : null}
      {(rows.data ?? []).map((r) => (
        <View
          key={r.id}
          className="flex-row items-center gap-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm">{r.email}</Text>
            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              {r.reason === 'complaint'
                ? 'Marked it as spam'
                : (r.detail ?? 'The address bounced')}
            </Text>
          </View>
          <ChipButton
            label="Clear"
            icon="close-circle-outline"
            tone="neutral"
            disabled={clear.isPending}
            onPress={() => clear.mutate(r.id)}
          />
        </View>
      ))}
    </View>
  );
}
