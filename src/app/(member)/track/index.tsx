import { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { TileGrid } from '@/components/TileGrid';
import { WorkoutHeatmap } from '@/components/WorkoutHeatmap';
import { useSession } from '@/lib/auth';
import { HYROX_TILE_META } from '@/lib/hyrox';
import {
  allGroupsDisciplineFirst,
  MOVEMENT_GROUPS,
  type Discipline,
  type Movement,
  type MovementGroup,
} from '@/lib/movements';
import { useLogNudge } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useGroupViewedMap } from '@/lib/useGroupViewed';
import { useMovementFavourites } from '@/lib/useFavouriteMovements';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { dueCheckIns, useMyInjuries } from '@/lib/useInjuries';
import { useOnboardingFlags, useSetOnboardingFlag } from '@/lib/useOnboardingFlags';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';
import {
  localDayKey,
  sessionsThisMonth,
  weekStreak,
  workoutStreak,
} from '@/lib/workout-streak';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
  const onboardingFlags = useOnboardingFlags();

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
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-5xl xl:max-w-7xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              Track
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
            className="bg-primary hover:opacity-90 active:bg-primary-dark rounded-full px-4 py-2.5 flex-row items-center gap-1.5">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="text-white text-sm font-semibold">Record</Text>
          </Pressable>
        </View>

        {journalCount.data === 0 &&
        !onboardingFlags.data?.track_how_it_works_dismissed ? (
          <TrackHowItWorks />
        ) : null}

        {(logNudge.data?.length ?? 0) > 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-emerald-300 dark:border-emerald-800 rounded-xl p-4 gap-2">
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-done-circle" size={18} color="#10B981" />
              <Text
                className="flex-1 text-ink dark:text-ink-dk font-semibold"
                numberOfLines={1}>
                {logNudge.data!.length === 1
                  ? `You trained ${logNudge.data![0].className} — log it?`
                  : `${logNudge.data!.length} sessions to log`}
              </Text>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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

        {/* Desktop dashboard: a compact heatmap rail beside the tile grid,
            which now carries Journal/Leaderboards/Library/Injury as its
            first four tiles alongside the movement groups — one grid
            reflowing together rather than two mismatched columns. On
            mobile the blocks stack in order; the rail width and column
            flip only engage at lg. */}
        <View className="gap-4 lg:flex-row lg:items-start">
          {(recentWorkouts.data?.size ?? 0) > 0 ? (
            <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-4 lg:w-80">
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
                <FieldLabel>
                  Last 12 weeks
                </FieldLabel>
                <WorkoutHeatmap
                  loggedDays={recentWorkouts.data ?? new Set()}
                  anchor={new Date()}
                  primaryColor={colors.primary}
                />
              </View>
            </View>
          ) : null}

          <View className="lg:flex-1">
            <MyMovementsCard
              discipline={discipline}
              recentByGroup={recentByGroup}
              journalCount={journalCount.data ?? 0}
            />
          </View>
        </View>
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
    <View className="flex-1 bg-raised dark:bg-raised-dk rounded-xl p-3 gap-1">
      <View
        style={{ backgroundColor: `${tint}26` }}
        className="w-8 h-8 rounded-full items-center justify-center">
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text className="text-ink dark:text-ink-dk text-2xl font-bold leading-7">
        {value}
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-4">
        {label}
      </Text>
    </View>
  );
}

// First-run orientation: a member with nothing logged yet lands on a
// wall of similar-looking tiles with no sense of how they connect. This
// lays out the flow in one line each and is gated by TrackHome on the
// journal count, so it vanishes the moment they log their first session
// and regulars never see it.
function TrackHowItWorks() {
  const colors = useThemeColors();
  const setFlag = useSetOnboardingFlag();
  const steps: { icon: IoniconName; tint: string; title: string; desc: string }[] = [
    {
      icon: 'add-circle-outline',
      tint: colors.primary,
      title: 'Record',
      desc: "Tap Record to log today's workout or an old PR.",
    },
    {
      icon: 'book-outline',
      tint: colors.primary,
      title: 'Journal',
      desc: 'Every session you log lands here as your history.',
    },
    {
      icon: 'trending-up-outline',
      tint: '#10B981',
      title: 'Movements',
      desc: 'PRs and best times build up under each movement you train.',
    },
    {
      icon: 'trophy-outline',
      tint: '#F59E0B',
      title: 'Leaderboards',
      desc: 'See how your lifts and times stack up against the gym.',
    },
  ];
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 border border-primary/20">
      <View className="flex-row items-start gap-3">
        <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="compass-outline" size={22} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            How Track works
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Your workouts, PRs and progress — all in one place.
          </Text>
        </View>
        <Pressable
          onPress={() => setFlag('track_how_it_works_dismissed')}
          hitSlop={8}
          className="shrink-0 active:opacity-70">
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium text-right">
            Don't show me again
          </Text>
        </Pressable>
      </View>
      <View className="gap-3">
        {steps.map((s) => (
          <View key={s.title} className="flex-row items-start gap-3">
            <View
              style={{ backgroundColor: `${s.tint}26` }}
              className="w-8 h-8 rounded-full items-center justify-center">
              <Ionicons name={s.icon} size={16} color={s.tint} />
            </View>
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                {s.title}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {s.desc}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// Same elevated white shadow-soft shell the movement tiles use — kept
// identical so this row doesn't read as washed-out or lower-priority —
// plus a colored top edge in the tile's own accent so the row still
// reads as a distinct kind of tile (navigation/tools) rather than more
// pinned-movement content.
const TOOL_TILE_CLASS =
  'bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70 border-t-4';

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
      style={{ borderTopColor: accent }}
      className={TOOL_TILE_CLASS}>
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
        <Text className="text-ink dark:text-ink-dk font-semibold text-base">
          Journal
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
      style={{ borderTopColor: accent }}
      className={TOOL_TILE_CLASS}>
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
        <Text className="text-ink dark:text-ink-dk font-semibold text-base">
          Leaderboards
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
      style={{ borderTopColor: accent }}
      className={TOOL_TILE_CLASS}>
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
          className="text-ink dark:text-ink-dk font-semibold text-base"
          numberOfLines={2}>
          Injury tracker
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {open.length === 0
            ? 'Log a niggle'
            : `${open.length} open ${open.length === 1 ? 'injury' : 'injuries'}`}
        </Text>
      </View>
    </Pressable>
  );
}

// Entry point to the cross-discipline Movement Library (search + browse
// the full catalog + starred favourites). Shares the grid tile shape so
// it reads as a sibling of the movement groups / stations.
function LibraryTile() {
  const accent = '#6366F1';
  return (
    <Pressable
      onPress={() => router.push('/track/movements' as never)}
      style={{ borderTopColor: accent }}
      className={TOOL_TILE_CLASS}>
      <View
        style={{ backgroundColor: accent }}
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10"
      />
      <View
        style={{ backgroundColor: `${accent}26` }}
        className="w-11 h-11 rounded-full items-center justify-center">
        <Ionicons name="library-outline" size={22} color={accent} />
      </View>
      <View className="flex-1 justify-end">
        <Text
          className="text-ink dark:text-ink-dk font-semibold text-base"
          numberOfLines={2}>
          Movement Library
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Search & star all movements
        </Text>
      </View>
    </Pressable>
  );
}

// A starred movement renders with its own chrome where we have it (Hyrox
// stations keep their colour + work spec); otherwise it inherits the
// group's icon/accent and shows the group name as its subtitle.
function movementTileChrome(group: MovementGroup, movement: Movement) {
  const hyrox = HYROX_TILE_META[movement.key];
  return {
    icon: (hyrox?.icon ?? group.icon) as IoniconName,
    accent: hyrox?.accent ?? group.accent,
    spec: hyrox?.spec ?? group.name,
  };
}

type FavTile =
  | { kind: 'group'; group: MovementGroup; count: number }
  | { kind: 'movement'; group: MovementGroup; movement: Movement };

function FavMovementTile({
  group,
  movement,
}: {
  group: MovementGroup;
  movement: Movement;
}) {
  const chrome = movementTileChrome(group, movement);
  return (
    <StationTile
      name={movement.name}
      spec={chrome.spec}
      icon={chrome.icon}
      accent={chrome.accent}
      onPress={() =>
        router.push(`/track/movement/${movement.key}` as never)
      }
    />
  );
}

// Turn the member's starred groups/movements into home tiles. A starred
// group is a group tile while ≥2 of its movements remain selected; it
// collapses to a single movement tile at one, and disappears at zero.
// Movements starred on their own always render as their own tiles.
function deriveTiles(
  groups: Set<string>,
  movements: Set<string>,
  discipline: Discipline,
): FavTile[] {
  const out: FavTile[] = [];
  for (const g of allGroupsDisciplineFirst(discipline)) {
    const selected = g.movements.filter((m) => movements.has(m.key));
    if (selected.length === 0) continue;
    if (groups.has(g.key)) {
      if (selected.length >= 2) out.push({ kind: 'group', group: g, count: selected.length });
      else out.push({ kind: 'movement', group: g, movement: selected[0] });
    } else {
      for (const m of selected) out.push({ kind: 'movement', group: g, movement: m });
    }
  }
  return out;
}

// The member's pinned movements & groups, rendered from their
// favourites (which default to the gym discipline's catalog), below a
// fixed row of the four utility tiles (Journal, Leaderboards, Library,
// Injury). Each gets its own heading and grid — Tools uses a fixed
// 2/4-column layout (right for exactly four tiles; TileGrid's 3-column
// tier would strand two empty cells at that count) and a colored top
// edge per tile, so the row reads as its own distinct kind of tile
// without losing the movement tiles' elevated card weight. Movements
// keeps TileGrid's 2/3/4 reflow, which suits its variable, often-larger
// count.
function MyMovementsCard({
  discipline,
  recentByGroup,
  journalCount,
}: {
  discipline: Discipline;
  recentByGroup: Record<string, number>;
  journalCount: number;
}) {
  const colors = useThemeColors();
  const fav = useMovementFavourites(discipline);
  const favTiles = useMemo(
    () => deriveTiles(fav.groups, fav.movements, discipline),
    [fav.groups, fav.movements, discipline],
  );

  return (
    <View className="gap-5">
      <View className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="w-11 h-11 rounded-full bg-ink-3/15 items-center justify-center">
            <Ionicons name="grid-outline" size={22} color="#6B7280" />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Tools
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Journal, leaderboards, the library &amp; injuries.
            </Text>
          </View>
        </View>

        <View className="flex-row flex-wrap -m-1">
          <View className="w-1/2 md:w-1/4 p-1">
            <JournalEntryTile workoutCount={journalCount} />
          </View>
          <View className="w-1/2 md:w-1/4 p-1">
            <LeaderboardsTile />
          </View>
          <View className="w-1/2 md:w-1/4 p-1">
            <LibraryTile />
          </View>
          <View className="w-1/2 md:w-1/4 p-1">
            <InjuryTile />
          </View>
        </View>
      </View>

      <View className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
            <Ionicons name="barbell-outline" size={22} color={colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Movements
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Your pinned movements &amp; groups — edit in the Library.
            </Text>
          </View>
        </View>

        {favTiles.length > 0 ? (
          <TileGrid>
            {favTiles.map((t) =>
              t.kind === 'group' ? (
                <GroupTile
                  key={`g:${t.group.key}`}
                  name={t.group.name}
                  count={t.count}
                  icon={t.group.icon as IoniconName}
                  accent={t.group.accent}
                  recentCount={recentByGroup[t.group.key] ?? 0}
                  onPress={() =>
                    router.push(`/track/group/${t.group.key}` as never)
                  }
                />
              ) : (
                <FavMovementTile
                  key={`m:${t.movement.key}`}
                  group={t.group}
                  movement={t.movement}
                />
              ),
            )}
          </TileGrid>
        ) : (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Nothing pinned yet. Star movements or groups in the Library to pin
            them here.
          </Text>
        )}
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
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
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
          className="text-ink dark:text-ink-dk font-semibold text-base"
          numberOfLines={2}>
          {name}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">{spec}</Text>
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
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 min-h-[124px] flex-1 overflow-hidden active:opacity-70">
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
          className="text-ink dark:text-ink-dk font-semibold text-base"
          numberOfLines={2}>
          {name}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {count} {count === 1 ? 'movement' : 'movements'}
        </Text>
      </View>
    </Pressable>
  );
}

