import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { findMovement, type Metric } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import {
  bestOf,
  fmtDateShort,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

export default function MovementDetail() {
  const { movement: movementKey } = useLocalSearchParams<{ movement: string }>();
  const session = useSession();
  const meta = movementKey ? findMovement(movementKey) : undefined;
  const [recording, setRecording] = useState(false);

  const results = useQuery({
    queryKey: ['tracked-results-by-movement', session?.user.id, movementKey],
    enabled: !!session?.user.id && !!movementKey,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey!)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  if (!meta) {
    return (
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
          Unknown movement.
        </Text>
      </Screen>
    );
  }

  const { group, movement } = meta;
  const rows = results.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Link href={`/track/group/${group.key}` as never} asChild>
            <Pressable hitSlop={6} className="active:opacity-70">
              <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
            </Pressable>
          </Link>
          <View className="flex-1">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              {group.name}
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {movement.name}
            </Text>
          </View>
          <Pressable
            onPress={() => setRecording(true)}
            hitSlop={6}
            className="bg-primary active:bg-primary-dark rounded-full px-3 py-1.5 flex-row items-center gap-1">
            <Ionicons name="add" size={14} color="#FFFFFF" />
            <Text className="text-white text-xs font-semibold">Record</Text>
          </Pressable>
        </View>

        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Rep maxes
          </Text>
          <View className="gap-2">
            {movement.schemes.map((scheme) => {
              const schemeRows = rows.filter((r) => r.track_key === scheme.key);
              const best = bestOf(schemeRows, scheme);
              const display = best
                ? formatResultValue(best, scheme.metric)
                : null;
              return (
                <View
                  key={scheme.key}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                      {scheme.label}
                    </Text>
                    {best ? (
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        Set {fmtDateShort(best.performed_at)}
                      </Text>
                    ) : (
                      <Text className="text-gray-400 dark:text-gray-500 text-xs">
                        No result yet
                      </Text>
                    )}
                  </View>
                  <Text
                    className={
                      display
                        ? 'text-gray-900 dark:text-gray-50 text-lg font-semibold'
                        : 'text-gray-400 dark:text-gray-500 text-sm'
                    }>
                    {display ?? '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Journal
          </Text>
          {results.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading…
            </Text>
          ) : rows.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No results for {movement.name} yet.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {rows.map((r) => (
                <JournalRow
                  key={r.id}
                  row={r}
                  schemeLabel={
                    movement.schemes.find((s) => s.key === r.track_key)?.label ??
                    r.track_key
                  }
                  metric={
                    movement.schemes.find((s) => s.key === r.track_key)?.metric
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <RecordWorkoutModal
        visible={recording}
        onClose={() => setRecording(false)}
        initialMovementKey={movement.key}
      />
    </Screen>
  );
}

function JournalRow({
  row,
  schemeLabel,
  metric,
}: {
  row: TrackedResultRow;
  schemeLabel: string;
  metric: Metric | undefined;
}) {
  const display = metric ? formatResultValue(row, metric) : null;
  return (
    <Pressable
      onPress={() => router.push('/track/journal' as never)}
      className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
          {schemeLabel}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {fmtDateShort(row.performed_at)}
          {row.notes ? ` · ${row.notes}` : ''}
        </Text>
      </View>
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {display ?? '—'}
      </Text>
    </Pressable>
  );
}
