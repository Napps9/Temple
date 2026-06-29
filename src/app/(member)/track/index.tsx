import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { WorkoutHeatmap } from '@/components/WorkoutHeatmap';
import { useSession } from '@/lib/auth';
import { HYROX_SIM, HYROX_STATIONS, type HyroxStation } from '@/lib/hyrox';
import { MOVEMENT_GROUPS } from '@/lib/movements';
import { useLogNudge } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useGroupViewedMap } from '@/lib/useGroupViewed';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { dueCheckIns, useMyInjuries } from '@/lib/useInjuries';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';
import {
  localDayKey,
  sessionsThisMonth,
  weekStreak,
  workoutStreak,
} from '@/lib/workout-streak';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push(items.slice(i, i + 2));
  }
  return pairs;
}

export default function TrackHome() {
  const colors = useThemeColors();
  const session = useSession();
  const discipline = useGymDiscipline();
  const isHyrox = discipline === 'hyrox';
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [recordPrefill, setRecordPrefill] = useState<{
    date?: string;
    title?: string;
  } | null>(null);
  const logNudge = useLogNudge();

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

  // The Journal tile only needs to know whether the member has logged
  // anything (and roughly how recently) — the full journal renders on
  // /track/journal. A head count with a small cap is enough.
  const journalCount = useQuery({
    queryKey: ['tracked-journal-count', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('tracked_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', session!.user.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Last 90 days of workout dates — feeds both the streak tile and
  // the 12-week heatmap. Set of local-date keys; the heavy lifting
  // lives in workout-streak.ts and WorkoutHeatmap.
  const recentWorkouts = useQuery({
    queryKey: ['workout-streak-days', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Set<string>> => {
      const sinceIso = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select('performed_at')
        .eq('profile_id', session!.user.id)
        .gte('performed_at', sinceIso);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) =>
          localDayKey(new Date((r as { performed_at: string }).performed_at)),
        ),
      );
    },
  });
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekStartsOn: 'mon' | 'sun' = gymDefaults?.week_starts_on ?? 'mon';
  const streak = useMemo(
    () =>
      recentWorkouts.data ? workoutStreak(recentWorkouts.data, new Date()) : 0,
    [recentWorkouts.data],
  );
  const weeks = useMemo(
    () =>
      recentWorkouts.data
        ? weekStreak(recentWorkouts.data, new Date(), weekStartsOn)
        : 0,
    [recentWorkouts.data, weekStartsOn],
  );
  const monthSessions = useMemo(
    () =>
      recentWorkouts.data
        ? sessionsThisMonth(recentWorkouts.data, new Date())
        : 0,
    [recentWorkouts.data],
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Track
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {isHyrox
                ? 'Log your stations, run splits and race times.'
                : 'Log workouts and PRs across movements.'}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setRecordPrefill(null);
              setRecording(true);
            }}
            className="bg-primary active:bg-primary-dark rounded-full px-4 py-2.5 flex-row items-center gap-1.5">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="text-white text-sm font-semibold">Record</Text>
          </Pressable>
        </View>

        {(logNudge.data?.length ?? 0) > 0 ? (
          <View className="bg-white dark:bg-gray-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-4 gap-2">
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-done-circle" size={18} color="#10B981" />
              <Text
                className="flex-1 text-gray-900 dark:text-gray-50 font-semibold"
                numberOfLines={1}>
                {logNudge.data!.length === 1
                  ? `You trained ${logNudge.data![0].className} — log it?`
                  : `${logNudge.data!.length} sessions to log`}
              </Text>
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Logging keeps your streak, PRs and history up to date.
            </Text>
            <Pressable
              onPress={() => {
                const item = logNudge.data![0];
                setRecordPrefill({ date: item.day, title: item.className });
                setRecording(true);
              }}
              className="self-start flex-row items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 px-3 py-1.5 active:opacity-80">
              <Ionicons name="add" size={14} color="#10B981" />
              <Text className="text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                Log results
              </Text>
            </Pressable>
          </View>
        ) : null}

        {(recentWorkouts.data?.size ?? 0) > 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
            <View className="flex-row gap-2">
              <Stat
                icon="flame"
                tint="#F59E0B"
                value={streak}
                label={streak === 1 ? 'day in a row' : 'days in a row'}
              />
              <Stat
                icon="calendar"
                tint={colors.primary}
                value={weeks}
                label={weeks === 1 ? 'week in a row' : 'weeks in a row'}
              />
              <Stat
                icon="barbell"
                tint="#10B981"
                value={monthSessions}
                label="this month"
              />
            </View>
            <View className="gap-2">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                Last 12 weeks
              </Text>
              <WorkoutHeatmap
                loggedDays={recentWorkouts.data ?? new Set()}
                anchor={new Date()}
                primaryColor={colors.primary}
              />
            </View>
          </View>
        ) : null}

        {/* Journal + Leaderboards live as a 2-up tile row above the
            Movements grid — same tile shape as a movement group so they
            read as siblings instead of a stack of full-width cards. */}
        <View className="flex-row items-stretch gap-2">
          <View className="flex-1">
            <JournalEntryTile workoutCount={journalCount.data ?? 0} />
          </View>
          <View className="flex-1">
            <LeaderboardsTile />
          </View>
        </View>

        {/* Movements / stations + injury tracker share a home: both are
            about how the body is moving. The grid swaps to the Hyrox
            stations when the gym runs that discipline. */}
        {isHyrox ? (
          <HyroxStationsCard />
        ) : (
          <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
            <View className="flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
                <Ionicons name="barbell-outline" size={22} color={colors.primary} />
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
        )}
      </ScrollView>

      <RecordWorkoutModal
        visible={recording}
        discipline={discipline}
        initialDate={recordPrefill?.date}
        initialTitle={recordPrefill?.title}
        onClose={() => {
          setRecording(false);
          queryClient.invalidateQueries({ queryKey: ['log-nudge'] });
        }}
      />
    </Screen>
  );
}

// Consistency stat — a number the member watches climb (day streak,
// week streak, sessions this month). Derived from the same logged-day
// set that feeds the heatmap.
function Stat({
  icon,
  tint,
  value,
  label,
}: {
  icon: IoniconName;
  tint: string;
  value: number;
  label: string;
}) {
  return (
    <View className="flex-1 bg-slate-100 dark:bg-gray-800 rounded-xl p-3 gap-1">
      <View
        style={{ backgroundColor: `${tint}26` }}
        className="w-8 h-8 rounded-full items-center justify-center">
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text className="text-gray-900 dark:text-gray-50 text-2xl font-bold leading-7">
        {value}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-xs leading-4">
        {label}
      </Text>
    </View>
  );
}

// Group-tile shape (slate background, rounded icon, accent blob).
function JournalEntryTile({ workoutCount }: { workoutCount: number }) {
  const colors = useThemeColors();
  const accent = colors.primary;
  const subtitle =
    workoutCount === 0
      ? 'No sessions logged yet'
      : `${workoutCount} logged ${workoutCount === 1 ? 'session' : 'sessions'}`;
  return (
    <Pressable
      onPress={() => router.push('/track/journal' as never)}
      className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
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
        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
          Journal
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function LeaderboardsTile() {
  const accent = '#F59E0B';
  return (
    <Pressable
      onPress={() => router.push('/track/leaderboards' as never)}
      className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
      <View
        style={{ backgroundColor: accent }}
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10"
      />
      <View
        style={{ backgroundColor: `${accent}26` }}
        className="w-11 h-11 rounded-full items-center justify-center">
        <Ionicons name="trophy-outline" size={22} color={accent} />
      </View>
      <View className="flex-1 justify-end">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
          Leaderboards
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Heaviest lifts, fastest times, hardest AMRAPs.
        </Text>
      </View>
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

// The Hyrox Track grid — the eight stations + 1 km run split, the race
// simulation, and the injury tracker, each tile deep-linking straight
// to that station's PB / trend / journal detail.
function HyroxStationsCard() {
  const colors = useThemeColors();
  const tiles: ({ kind: 'station'; station: HyroxStation } | { kind: 'sim' } | {
    kind: 'injury';
  })[] = [
    ...HYROX_STATIONS.map((station) => ({ kind: 'station' as const, station })),
    { kind: 'sim' as const },
    { kind: 'injury' as const },
  ];
  return (
    <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
      <View className="flex-row items-center gap-3">
        <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="flame-outline" size={22} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Hyrox stations
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Best times per station, run split and race.
          </Text>
        </View>
      </View>

      <View className="gap-2">
        {chunkPairs(tiles).map((pair, i) => (
          <View key={i} className="flex-row items-stretch gap-2">
            {pair.map((tile, j) => (
              <View key={j} className="flex-1">
                {tile.kind === 'station' ? (
                  <StationTile
                    name={tile.station.name}
                    spec={tile.station.spec}
                    icon={tile.station.icon as IoniconName}
                    accent={tile.station.accent}
                    onPress={() =>
                      router.push(
                        `/track/movement/${tile.station.key}` as never,
                      )
                    }
                  />
                ) : tile.kind === 'sim' ? (
                  <StationTile
                    name={HYROX_SIM.name}
                    spec={HYROX_SIM.spec}
                    icon={HYROX_SIM.icon as IoniconName}
                    accent={HYROX_SIM.accent}
                    onPress={() =>
                      router.push(`/track/movement/${HYROX_SIM.key}` as never)
                    }
                  />
                ) : (
                  <InjuryTile />
                )}
              </View>
            ))}
            {pair.length === 1 ? <View className="flex-1" /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function StationTile({
  name,
  spec,
  icon,
  accent,
  onPress,
}: {
  name: string;
  spec: string;
  icon: IoniconName;
  accent: string;
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
      <View className="flex-1 justify-end">
        <Text
          className="text-gray-900 dark:text-gray-50 font-semibold text-base"
          numberOfLines={2}>
          {name}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{spec}</Text>
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

