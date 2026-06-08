import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { findGroup } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import {
  bestOf,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

export default function GroupPage() {
  const { group: groupKey } = useLocalSearchParams<{ group: string }>();
  const session = useSession();
  const group = groupKey ? findGroup(groupKey) : undefined;

  const movementKeys = group?.movements.map((m) => m.key) ?? [];

  const results = useQuery({
    queryKey: [
      'tracked-results-by-group',
      session?.user.id,
      groupKey,
      movementKeys.join(','),
    ],
    enabled: !!session?.user.id && movementKeys.length > 0,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .in('movement_key', movementKeys)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  if (!group) {
    return (
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
          Unknown movement group.
        </Text>
      </Screen>
    );
  }

  const byMovement = new Map<string, TrackedResultRow[]>();
  for (const r of results.data ?? []) {
    const list = byMovement.get(r.movement_key) ?? [];
    list.push(r);
    byMovement.set(r.movement_key, list);
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Link href="/track" asChild>
            <Pressable hitSlop={6} className="active:opacity-70">
              <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
            </Pressable>
          </Link>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {group.name}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {group.blurb}
            </Text>
          </View>
        </View>

        <View className="gap-2">
          {group.movements.map((m) => {
            const rows = byMovement.get(m.key) ?? [];
            // Use the headline scheme — typically 1RM — as the badge.
            const headlineScheme = m.schemes[0];
            const headlineRows = rows.filter(
              (r) => r.track_key === headlineScheme.key,
            );
            const best = bestOf(headlineRows, headlineScheme);
            const display = best
              ? formatResultValue(best, headlineScheme.metric)
              : null;
            return (
              <Pressable
                key={m.key}
                onPress={() =>
                  router.push(`/track/movement/${m.key}` as never)
                }
                className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 active:opacity-70">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {m.name}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {headlineScheme.label}
                  </Text>
                </View>
                <View className="items-end">
                  <Text
                    className={
                      display
                        ? 'text-gray-900 dark:text-gray-50 font-semibold'
                        : 'text-gray-400 dark:text-gray-500 text-sm'
                    }>
                    {display ?? '—'}
                  </Text>
                  {rows.length > 0 ? (
                    <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
                      {rows.length} logged
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
