import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { MOVEMENT_GROUPS } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { fmtDateShort, type TrackedWorkoutRow } from '@/lib/track';

const JOURNAL_PREVIEW_COUNT = 4;

export default function TrackHome() {
  const session = useSession();
  const [recording, setRecording] = useState(false);

  const journal = useQuery({
    queryKey: ['tracked-journal', session?.user.id, 'preview'],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<TrackedWorkoutRow[]> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          'id, performed_at, title, notes, class_session_id, results:tracked_movement_results(id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at)',
        )
        .eq('profile_id', session!.user.id)
        .order('performed_at', { ascending: false })
        .limit(JOURNAL_PREVIEW_COUNT);
      if (error) throw error;
      return (data ?? []) as unknown as TrackedWorkoutRow[];
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Track
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Log workouts and PRs across movements.
          </Text>
        </View>

        <Pressable
          onPress={() => setRecording(true)}
          className="bg-primary active:bg-primary-dark rounded-xl p-4 flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-base">
              Record workout
            </Text>
            <Text className="text-white/80 text-xs">
              Add results from today or any past session.
            </Text>
          </View>
        </Pressable>

        <View className="gap-3">
          <View className="flex-row items-center">
            <Text className="flex-1 text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Journal
            </Text>
            <Link href="/track/journal" asChild>
              <Pressable hitSlop={6} className="active:opacity-70">
                <Text className="text-primary text-xs uppercase tracking-widest">
                  See all
                </Text>
              </Pressable>
            </Link>
          </View>
          {journal.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading…
            </Text>
          ) : (journal.data?.length ?? 0) === 0 ? (
            <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No workouts logged yet. Tap "Record workout" to start.
              </Text>
            </View>
          ) : (
            journal.data!.map((w) => <JournalCard key={w.id} workout={w} />)
          )}
        </View>

        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Movements
          </Text>
          <View className="flex-row flex-wrap -mx-1">
            {MOVEMENT_GROUPS.map((g) => (
              <View key={g.key} className="w-1/2 p-1">
                <GroupTile
                  name={g.name}
                  count={g.movements.length}
                  icon={g.icon as IoniconName}
                  accent={g.accent}
                  onPress={() =>
                    router.push(`/track/group/${g.key}` as never)
                  }
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <RecordWorkoutModal
        visible={recording}
        onClose={() => setRecording(false)}
      />
    </Screen>
  );
}

function GroupTile({
  name,
  count,
  icon,
  accent,
  onPress,
}: {
  name: string;
  count: number;
  icon: IoniconName;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3 min-h-[124px] overflow-hidden active:opacity-70">
      <View
        style={{ backgroundColor: accent }}
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10"
      />
      <View
        style={{ backgroundColor: `${accent}26` }}
        className="w-11 h-11 rounded-full items-center justify-center">
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <View className="flex-1 justify-end">
        <Text
          className="text-gray-900 dark:text-gray-50 font-semibold text-base"
          numberOfLines={2}>
          {name}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {count} {count === 1 ? 'movement' : 'movements'}
        </Text>
      </View>
    </Pressable>
  );
}

function JournalCard({ workout }: { workout: TrackedWorkoutRow }) {
  return (
    <Pressable
      onPress={() => router.push('/track/journal' as never)}
      className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 active:opacity-70">
      <View className="flex-row items-center">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-medium">
          {workout.title?.trim() || 'Workout'}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {fmtDateShort(workout.performed_at)}
        </Text>
      </View>
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        {workout.results.length}{' '}
        {workout.results.length === 1 ? 'result' : 'results'}
      </Text>
    </Pressable>
  );
}
