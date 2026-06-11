import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { MOVEMENT_GROUPS } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { fmtDateShort } from '@/lib/track';
import { useGroupViewedMap } from '@/lib/useGroupViewed';
import { dueCheckIns, useMyInjuries } from '@/lib/useInjuries';

type PreviewWorkout = {
  id: string;
  performed_at: string;
  title: string | null;
  section_count: { count: number }[] | null;
  result_count: { count: number }[] | null;
};

// Four-up so the 2-column grid sits as a clean 2×2 — same shape as
// the Movements tiles below it.
const JOURNAL_PREVIEW_COUNT = 4;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push(items.slice(i, i + 2));
  }
  return pairs;
}

export default function TrackHome() {
  const session = useSession();
  const [recording, setRecording] = useState(false);

  // Logs from the last week per movement group — used to show
  // fresh-activity badges. The query returns rows with their
  // movement_key + performed_at so the count can shrink after the
  // member visits the group (we filter against that group's
  // last-viewed timestamp at render time, no refetch needed).
  const recentLogs = useQuery({
    queryKey: ['recent-movement-logs', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<{ movement_key: string; performed_at: string }[]> => {
      const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const [direct, tags] = await Promise.all([
        supabase
          .from('tracked_movement_results')
          .select('movement_key, performed_at')
          .eq('profile_id', session!.user.id)
          .gte('performed_at', sinceIso),
        supabase
          .from('tracked_section_movement_tags')
          .select('movement_key, performed_at')
          .eq('profile_id', session!.user.id)
          .gte('performed_at', sinceIso),
      ]);
      if (direct.error) throw direct.error;
      if (tags.error) throw tags.error;
      return [
        ...(direct.data ?? []),
        ...(tags.data ?? []),
      ] as { movement_key: string; performed_at: string }[];
    },
  });

  const groupViewed = useGroupViewedMap();

  const recentByGroup = useMemo<Record<string, number>>(() => {
    const groupOf = new Map<string, string>();
    for (const g of MOVEMENT_GROUPS)
      for (const m of g.movements) groupOf.set(m.key, g.key);
    const viewed = groupViewed.data ?? {};
    const counts: Record<string, number> = {};
    for (const r of recentLogs.data ?? []) {
      const gk = groupOf.get(r.movement_key);
      if (!gk) continue;
      // Only count logs the member hasn't visited the group since.
      if (viewed[gk] && r.performed_at <= viewed[gk]) continue;
      counts[gk] = (counts[gk] ?? 0) + 1;
    }
    return counts;
  }, [recentLogs.data, groupViewed.data]);

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
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Track
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Log workouts and PRs across movements.
            </Text>
          </View>
          <Pressable
            onPress={() => setRecording(true)}
            className="bg-primary active:bg-primary-dark rounded-full px-4 py-2.5 flex-row items-center gap-1.5">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="text-white text-sm font-semibold">Record</Text>
          </Pressable>
        </View>

        {/* Journal */}
        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
              <Ionicons name="book-outline" size={22} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Journal
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Your latest logged sessions.
              </Text>
            </View>
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
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No workouts logged yet. Tap "Record" to start.
            </Text>
          ) : (
            // Same 2-column tile grid as the Movements section so the
            // Journal preview reads as a sibling rather than a
            // full-bleed dump of every recorded section.
            <View className="gap-2">
              {chunkPairs(journal.data!).map((pair, i) => (
                <View key={i} className="flex-row items-stretch gap-2">
                  {pair.map((w) => (
                    <View key={w.id} className="flex-1">
                      <JournalTile workout={w} />
                    </View>
                  ))}
                  {pair.length === 1 ? (
                    <View className="flex-1" />
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        <LeaderboardsTile />

        {/* Movements + injury tracker share a home: both are about how
            the body is moving. */}
        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
              <Ionicons name="barbell-outline" size={22} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Movements
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                PRs and history per movement.
              </Text>
            </View>
          </View>

          {/* Explicit row pairs (rather than flex-wrap) so the two tiles
              in each row stretch to the taller item's height — flex-wrap
              alone wouldn't equalise them, and "Bodyweight Movements"
              (two-line title) was making the injury tile look squashed. */}
          <View className="gap-2">
            {chunkPairs([
              ...MOVEMENT_GROUPS.map((g) => ({
                kind: 'group' as const,
                key: g.key,
                group: g,
              })),
              { kind: 'injury' as const, key: 'injury' },
            ]).map((pair, i) => (
              <View key={i} className="flex-row items-stretch gap-2">
                {pair.map((tile) =>
                  tile.kind === 'group' ? (
                    <View key={tile.key} className="flex-1">
                      <GroupTile
                        name={tile.group.name}
                        count={tile.group.movements.length}
                        icon={tile.group.icon as IoniconName}
                        accent={tile.group.accent}
                        recentCount={recentByGroup[tile.group.key] ?? 0}
                        onPress={() =>
                          router.push(
                            `/track/group/${tile.group.key}` as never,
                          )
                        }
                      />
                    </View>
                  ) : (
                    <View key={tile.key} className="flex-1">
                      <InjuryTile />
                    </View>
                  ),
                )}
                {pair.length === 1 ? <View className="flex-1" /> : null}
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

// Injury tracker rendered in the same grid as the movement groups —
// shares GroupTile's shape (accent bubble, name, count, badge) so the
// row never strands an empty slot, and the user sees injuries as part
// of the same "how is my body moving" picture.
function InjuryTile() {
  const injuries = useMyInjuries();
  const open = (injuries.data ?? []).filter((r) => r.status !== 'resolved');
  const due = dueCheckIns(injuries.data);
  const accent = '#EF4444';
  return (
    <Pressable
      onPress={() => router.push('/track/injuries' as never)}
      className="bg-slate-100 dark:bg-gray-800 rounded-xl p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
      <View
        style={{ backgroundColor: accent }}
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10"
      />
      <View
        style={{ backgroundColor: `${accent}26` }}
        className="w-11 h-11 rounded-full items-center justify-center">
        <Ionicons name="body-outline" size={22} color={accent} />
      </View>
      {due.length > 0 ? (
        <View className="absolute right-3 top-3 bg-amber-500 rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-bold">
            {due.length} due
          </Text>
        </View>
      ) : null}
      <View className="flex-1 justify-end">
        <Text
          className="text-gray-900 dark:text-gray-50 font-semibold text-base"
          numberOfLines={2}>
          Injury tracker
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {open.length === 0
            ? 'Log a niggle'
            : `${open.length} open ${open.length === 1 ? 'injury' : 'injuries'}`}
        </Text>
      </View>
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
      className="bg-slate-100 dark:bg-gray-800 rounded-xl p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
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

// Rich preview: the workout title + date, then each recorded section
// matched the Movements grid below it; the full programmed body,
// result, entries and tagged movements still live on the workout
// detail page that the tile routes into.
function JournalTile({ workout }: { workout: PreviewWorkout }) {
  const sectionCount = workout.section_count?.[0]?.count ?? 0;
  const resultCount = workout.result_count?.[0]?.count ?? 0;
  const subtitle =
    sectionCount > 0
      ? `${sectionCount} section${sectionCount === 1 ? '' : 's'}`
      : resultCount > 0
        ? `${resultCount} result${resultCount === 1 ? '' : 's'}`
        : 'No results yet';
  const accent = '#2563EB';
  return (
    <Pressable
      onPress={() =>
        router.push(`/track/workout/${workout.id}` as never)
      }
      className="bg-slate-100 dark:bg-gray-800 rounded-xl p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
      <View
        style={{ backgroundColor: accent }}
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10"
      />
      <View
        style={{ backgroundColor: `${accent}26` }}
        className="w-11 h-11 rounded-full items-center justify-center">
        <Ionicons name="book-outline" size={22} color={accent} />
      </View>
      <View className="flex-1 justify-end">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
          {fmtDateShort(workout.performed_at)}
        </Text>
        <Text
          className="text-gray-900 dark:text-gray-50 font-semibold text-base"
          numberOfLines={2}>
          {workout.title?.trim() || 'Workout'}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
