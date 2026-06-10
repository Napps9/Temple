import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { MOVEMENT_GROUPS } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { fmtDateShort } from '@/lib/track';

type PreviewWorkout = {
  id: string;
  performed_at: string;
  title: string | null;
  section_count: { count: number }[] | null;
  result_count: { count: number }[] | null;
};

const JOURNAL_PREVIEW_COUNT = 4;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function TrackHome() {
  const session = useSession();
  const [recording, setRecording] = useState(false);

  // Logs from the last week, bucketed by movement group, so the group
  // tiles can show fresh-activity badges (direct PRs + section tags).
  const recentByGroup = useQuery({
    queryKey: ['recent-movement-logs', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Record<string, number>> => {
      const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const [direct, tags] = await Promise.all([
        supabase
          .from('tracked_movement_results')
          .select('movement_key')
          .eq('profile_id', session!.user.id)
          .gte('performed_at', sinceIso),
        supabase
          .from('tracked_section_movement_tags')
          .select('movement_key')
          .eq('profile_id', session!.user.id)
          .gte('performed_at', sinceIso),
      ]);
      if (direct.error) throw direct.error;
      if (tags.error) throw tags.error;
      const groupOf = new Map<string, string>();
      for (const g of MOVEMENT_GROUPS)
        for (const m of g.movements) groupOf.set(m.key, g.key);
      const counts: Record<string, number> = {};
      const rows = [...(direct.data ?? []), ...(tags.data ?? [])] as {
        movement_key: string;
      }[];
      for (const r of rows) {
        const gk = groupOf.get(r.movement_key);
        if (!gk) continue;
        counts[gk] = (counts[gk] ?? 0) + 1;
      }
      return counts;
    },
  });

  const journal = useQuery({
    queryKey: ['tracked-journal', session?.user.id, 'preview'],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<PreviewWorkout[]> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          'id, performed_at, title, section_count:tracked_workout_sections(count), result_count:tracked_movement_results(count)',
        )
        .eq('profile_id', session!.user.id)
        .order('performed_at', { ascending: false })
        .limit(JOURNAL_PREVIEW_COUNT);
      if (error) throw error;
      return (data ?? []) as unknown as PreviewWorkout[];
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
            <ChipButton
              label="See all"
              icon="arrow-forward"
              iconSide="right"
              onPress={() => router.push('/track/journal')}
            />
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

        <LeaderboardsTile />

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
                  recentCount={recentByGroup.data?.[g.key] ?? 0}
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

function LeaderboardsTile() {
  return (
    <Pressable
      onPress={() => router.push('/track/leaderboards' as never)}
      className="bg-white dark:bg-gray-900 rounded-2xl p-4 flex-row items-center gap-3 active:opacity-70">
      <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
        <Ionicons name="trophy-outline" size={22} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          Leaderboards
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          See who's lifting heaviest, running fastest, and AMRAP-ing
          hardest in the gym.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
    </Pressable>
  );
}

function GroupTile({
  name,
  count,
  icon,
  accent,
  recentCount = 0,
  onPress,
}: {
  name: string;
  count: number;
  icon: IoniconName;
  accent: string;
  recentCount?: number;
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
      {recentCount > 0 ? (
        <View className="absolute right-3 top-3 bg-primary rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-bold">
            {recentCount} new
          </Text>
        </View>
      ) : null}
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

function JournalCard({ workout }: { workout: PreviewWorkout }) {
  const sections = workout.section_count?.[0]?.count ?? 0;
  const results = workout.result_count?.[0]?.count ?? 0;
  const total = sections + results;
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
        {sections > 0
          ? `${sections} section${sections === 1 ? '' : 's'}`
          : total === 0
            ? 'No results yet'
            : `${results} result${results === 1 ? '' : 's'}`}
      </Text>
    </Pressable>
  );
}
