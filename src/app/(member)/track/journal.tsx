import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { findMovement, findScheme } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import {
  fmtDateLong,
  formatResultValue,
  type TrackedWorkoutRow,
} from '@/lib/track';

export default function Journal() {
  const session = useSession();
  const [recording, setRecording] = useState(false);

  const journal = useQuery({
    queryKey: ['tracked-journal', session?.user.id, 'all'],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<TrackedWorkoutRow[]> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          'id, performed_at, title, notes, class_session_id, results:tracked_movement_results(id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at)',
        )
        .eq('profile_id', session!.user.id)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedWorkoutRow[];
    },
  });

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
              Journal
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Every workout you've logged.
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

        {journal.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : (journal.data?.length ?? 0) === 0 ? (
          <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No workouts yet.
            </Text>
          </View>
        ) : (
          journal.data!.map((w) => <WorkoutCard key={w.id} workout={w} />)
        )}
      </ScrollView>

      <RecordWorkoutModal
        visible={recording}
        onClose={() => setRecording(false)}
      />
    </Screen>
  );
}

function WorkoutCard({ workout }: { workout: TrackedWorkoutRow }) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {workout.title?.trim() || 'Workout'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {fmtDateLong(workout.performed_at)}
          </Text>
        </View>
      </View>
      {workout.results.length === 0 ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs italic">
          No results recorded.
        </Text>
      ) : (
        <View className="gap-2">
          {workout.results.map((r) => (
            <ResultRow
              key={r.id}
              movementKey={r.movement_key}
              trackKey={r.track_key}
              valueNumeric={r.value_numeric}
              valueSeconds={r.value_seconds}
              valueUnit={r.value_unit}
              notes={r.notes}
            />
          ))}
        </View>
      )}
      {workout.notes ? (
        <Text className="text-gray-600 dark:text-gray-300 text-sm">
          {workout.notes}
        </Text>
      ) : null}
    </View>
  );
}

function ResultRow({
  movementKey,
  trackKey,
  valueNumeric,
  valueSeconds,
  valueUnit,
  notes,
}: {
  movementKey: string;
  trackKey: string;
  valueNumeric: number | null;
  valueSeconds: number | null;
  valueUnit: string | null;
  notes: string | null;
}) {
  const meta = findMovement(movementKey);
  const scheme = findScheme(movementKey, trackKey);
  const movementName = meta?.movement.name ?? movementKey;
  const schemeLabel = scheme?.label ?? trackKey;
  const display = scheme
    ? formatResultValue(
        { value_numeric: valueNumeric, value_seconds: valueSeconds, value_unit: valueUnit },
        scheme.metric,
      )
    : null;
  return (
    <Pressable
      onPress={() =>
        meta &&
        router.push(`/track/movement/${meta.movement.key}` as never)
      }
      className="flex-row items-center gap-3 active:opacity-70">
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
          {movementName}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {schemeLabel}
          {notes ? ` · ${notes}` : ''}
        </Text>
      </View>
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {display ?? '—'}
      </Text>
    </Pressable>
  );
}
