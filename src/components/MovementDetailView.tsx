import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { RecordHyroxRaceModal } from '@/components/RecordHyroxRaceModal';
import { RecordMovementResultModal } from '@/components/RecordMovementResultModal';
import { Screen } from '@/components/Screen';
import { Sparkline } from '@/components/Sparkline';
import { StrengthLeaderboard } from '@/components/StrengthLeaderboard';
import { useGymMembership, useSession } from '@/lib/auth';
import { HYROX_SIM } from '@/lib/hyrox';
import { findMovement, type Metric } from '@/lib/movements';
import {
  bestOfMerged,
  deriveTagValue,
  mergeJournal,
  prRowIds,
  type JournalRow,
  type SectionForDerivation,
  type TagInputRow,
} from '@/lib/movement-journal';
import { normaliseForPlot, trendPoints } from '@/lib/movement-trend';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useMovementFavourites } from '@/lib/useFavouriteMovements';
import {
  categoryLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import {
  fmtDateShort,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

// Shared per-movement detail, rendered by both the member route
// (full: record + leaderboard + workout links) and the gymless
// athlete route (read-only: just best-of, PR badges, trend, journal).
// `mode` is the single switch so the two route files stay thin and the
// fetch/merge/PR logic lives in exactly one place.
type Mode = 'member' | 'athlete';

type RawTagRow = {
  id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  section: {
    workout_id: string | null;
    section_category: SectionCategoryKey;
    title: string | null;
    section_format: SectionFormatKey;
    total_time_seconds: number | null;
    total_rounds: number | null;
    total_distance_m: number | null;
    total_calories: number | null;
    entries: {
      weight_numeric: number | null;
      reps: number | null;
      time_seconds: number | null;
      distance_numeric: number | null;
      calories: number | null;
    }[];
  } | null;
};

export function MovementDetailView({
  movementKey,
  mode,
}: {
  movementKey: string;
  mode: Mode;
}) {
  const isMember = mode === 'member';
  const session = useSession();
  const colors = useThemeColors();
  const discipline = useGymDiscipline();
  const meta = movementKey ? findMovement(movementKey) : undefined;
  const fav = useMovementFavourites(discipline);
  const starred = fav.movements.has(movementKey);
  const [recording, setRecording] = useState<{ trackKey?: string } | null>(
    null,
  );
  const [recordingRace, setRecordingRace] = useState(false);

  const direct = useQuery({
    queryKey: ['tracked-results-by-movement', session?.user.id, movementKey],
    enabled: !!session?.user.id && !!movementKey,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  const tags = useQuery({
    queryKey: ['tracked-tags-by-movement', session?.user.id, movementKey],
    enabled: !!session?.user.id && !!movementKey,
    queryFn: async (): Promise<RawTagRow[]> => {
      const { data, error } = await supabase
        .from('tracked_section_movement_tags')
        .select(
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(workout_id, section_category, title, section_format, total_time_seconds, total_rounds, total_distance_m, total_calories, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RawTagRow[];
    },
  });

  const merged = useMemo<JournalRow[]>(() => {
    if (!meta) return [];
    const direct_inputs = (direct.data ?? []).map((r) => ({
      id: r.id,
      workout_id: r.workout_id,
      movement_key: r.movement_key,
      track_key: r.track_key,
      value_numeric: r.value_numeric,
      value_seconds: r.value_seconds,
      value_unit: r.value_unit,
      notes: r.notes,
      performed_at: r.performed_at,
    }));
    const tag_inputs: TagInputRow[] = (tags.data ?? []).map((t) => {
      const scheme = t.track_key
        ? meta.movement.schemes.find((s) => s.key === t.track_key)
        : undefined;
      const derived =
        scheme && t.section
          ? deriveTagValue(scheme, t.section as SectionForDerivation)
          : { value_numeric: null, value_seconds: null };
      const sectionTitle = t.section
        ? t.section.title?.trim() || categoryLabel(t.section.section_category)
        : null;
      return {
        id: t.id,
        workout_id: t.section?.workout_id ?? null,
        section_title: sectionTitle,
        movement_key: t.movement_key,
        track_key: t.track_key,
        notes: t.notes,
        performed_at: t.performed_at,
        value_numeric: derived.value_numeric,
        value_seconds: derived.value_seconds,
        value_unit:
          scheme?.metric === 'weight'
            ? 'kg'
            : scheme?.metric === 'distance'
              ? 'm'
              : null,
      };
    });
    return mergeJournal(direct_inputs, tag_inputs);
  }, [meta, direct.data, tags.data]);

  const prIds = useMemo(() => {
    if (!meta) return new Set<string>();
    return prRowIds(merged, (key) =>
      meta.movement.schemes.find((s) => s.key === key),
    );
  }, [meta, merged]);

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
  // Hyrox stations log a single best time rather than a ladder of rep
  // maxes — relabel the bests section so it reads right for both.
  const isStation = group.key.startsWith('hyrox');
  const backHref = isMember ? `/track/group/${group.key}` : '/athlete';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline preferBack fallbackHref={backHref as Href} />
          <View className="flex-1">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              {group.name}
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {movement.name}
            </Text>
          </View>
          <Pressable
            onPress={() => fav.toggleMovement(movementKey, !starred)}
            hitSlop={8}
            accessibilityLabel={starred ? 'Unstar movement' : 'Star movement'}
            className="w-9 h-9 rounded-full items-center justify-center hover:opacity-80 active:opacity-60">
            <Ionicons
              name={starred ? 'star' : 'star-outline'}
              size={20}
              color={starred ? '#F59E0B' : colors.iconSecondary}
            />
          </Pressable>
          {isMember ? (
            <Pressable
              onPress={() => setRecording({})}
              hitSlop={6}
              className="bg-primary hover:opacity-90 active:bg-primary-dark rounded-full px-3 py-1.5 flex-row items-center gap-1">
              <Ionicons name="add" size={14} color="#FFFFFF" />
              <Text className="text-white text-xs font-semibold">Record</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              {isStation ? 'Personal bests' : 'Rep maxes'}
            </Text>
            {isMember && movement.key === HYROX_SIM.key ? (
              <Pressable
                onPress={() => setRecordingRace(true)}
                hitSlop={6}
                className="flex-row items-center gap-1 active:opacity-70">
                <Ionicons name="flag-outline" size={13} color={colors.primary} />
                <Text className="text-primary text-xs font-semibold">
                  Log full splits
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View className="gap-2">
            {movement.schemes.map((scheme) => {
              const best = bestOfMerged(merged, scheme.key, scheme);
              const display = best
                ? formatResultValue(best, scheme.metric)
                : null;
              const series = normaliseForPlot(
                trendPoints(merged, scheme.key, scheme.metric),
                scheme.better,
              );
              const row = (
                <View className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                      {scheme.label}
                    </Text>
                    {best ? (
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        Set {fmtDateShort(best.performed_at)}
                        {best.source === 'tag' ? ' · from session' : ''}
                      </Text>
                    ) : (
                      <Text className="text-gray-400 dark:text-gray-500 text-xs">
                        {isMember
                          ? `Tap to log a ${scheme.label.toLowerCase()}`
                          : 'No result logged'}
                      </Text>
                    )}
                  </View>
                  {series.length >= 2 ? (
                    <Sparkline
                      values={series}
                      color={colors.primary}
                      width={88}
                      height={32}
                      label={`${scheme.label} trend, ${series.length} results`}
                    />
                  ) : null}
                  <Text
                    className={
                      display
                        ? 'text-gray-900 dark:text-gray-50 text-lg font-semibold'
                        : 'text-gray-400 dark:text-gray-500 text-sm'
                    }>
                    {display ?? (isMember ? '+' : '—')}
                  </Text>
                </View>
              );
              return isMember ? (
                <Pressable
                  key={scheme.key}
                  onPress={() => setRecording({ trackKey: scheme.key })}
                  className="active:opacity-70">
                  {row}
                </Pressable>
              ) : (
                <View key={scheme.key}>{row}</View>
              );
            })}
          </View>
        </View>

        {isMember ? (
          <MovementLeaderboardSection
            movementKey={movement.key}
            schemes={movement.schemes}
          />
        ) : null}

        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Journal
          </Text>
          {direct.isLoading || tags.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading…
            </Text>
          ) : merged.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No results for {movement.name} yet.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {merged.map((r) => (
                <JournalRowView
                  key={r.id}
                  row={r}
                  schemeLabel={
                    movement.schemes.find((s) => s.key === r.track_key)?.label ??
                    r.track_key ??
                    'Untagged'
                  }
                  metric={
                    movement.schemes.find((s) => s.key === r.track_key)?.metric
                  }
                  isPR={prIds.has(r.id)}
                  linkable={isMember}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {isMember ? (
        <RecordMovementResultModal
          visible={recording !== null}
          discipline={discipline}
          onClose={() => setRecording(null)}
          initialMovementKey={movement.key}
          initialTrackKey={recording?.trackKey}
        />
      ) : null}

      {isMember && movement.key === HYROX_SIM.key ? (
        <RecordHyroxRaceModal
          visible={recordingRace}
          onClose={() => setRecordingRace(false)}
        />
      ) : null}
    </Screen>
  );
}

function MovementLeaderboardSection({
  movementKey,
  schemes,
}: {
  movementKey: string;
  schemes: { key: string; label: string; metric: Metric; better: 'higher' | 'lower' }[];
}) {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const enabled = useQuery({
    queryKey: ['gym-leaderboard-flags', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('strength_leaderboards_enabled')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data.strength_leaderboards_enabled;
    },
  });
  const [activeScheme, setActiveScheme] = useState<string>(schemes[0]?.key ?? '');
  if (enabled.data === false) return null;
  if (schemes.length === 0) return null;
  const scheme = schemes.find((s) => s.key === activeScheme) ?? schemes[0];
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="trophy-outline" size={18} color={colors.primary} />
        <Text className="flex-1 text-gray-900 dark:text-gray-50 text-lg font-semibold">
          Leaderboard
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {schemes.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setActiveScheme(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: s.key === scheme.key }}
            className={`rounded-full px-3 py-1 border active:opacity-70 ${
              s.key === scheme.key
                ? 'bg-primary border-primary'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}>
            <Text
              className={
                s.key === scheme.key
                  ? 'text-white text-xs'
                  : 'text-gray-700 dark:text-gray-200 text-xs'
              }>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <StrengthLeaderboard
        movementKey={movementKey}
        scheme={scheme}
        limit={5}
      />
    </View>
  );
}

function JournalRowView({
  row,
  schemeLabel,
  metric,
  isPR,
  linkable,
}: {
  row: JournalRow;
  schemeLabel: string;
  metric: Metric | undefined;
  isPR: boolean;
  linkable: boolean;
}) {
  const display = metric ? formatResultValue(row, metric) : null;
  const body = (
    <>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
            {row.section_title ?? schemeLabel}
          </Text>
          {isPR ? (
            <View className="rounded-full bg-amber-500/15 px-1.5 py-0.5 flex-row items-center gap-0.5">
              <Ionicons name="trophy" size={9} color="#F59E0B" />
              <Text className="text-amber-600 dark:text-amber-400 text-[9px] font-semibold uppercase tracking-wider">
                PR
              </Text>
            </View>
          ) : null}
          {row.source === 'tag' ? (
            <View className="rounded-full bg-primary/10 px-1.5 py-0.5">
              <Text className="text-primary text-[9px] font-semibold uppercase tracking-wider">
                Session
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {row.section_title ? `${schemeLabel} · ` : ''}
          {fmtDateShort(row.performed_at)}
          {row.notes ? ` · ${row.notes}` : ''}
        </Text>
      </View>
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {display ?? '—'}
      </Text>
    </>
  );
  if (!linkable) {
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() =>
        row.workout_id
          ? router.push(`/track/workout/${row.workout_id}` as never)
          : router.push('/track/journal' as never)
      }
      className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
      {body}
    </Pressable>
  );
}
