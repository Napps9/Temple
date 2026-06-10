import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecordMovementResultModal } from '@/components/RecordMovementResultModal';
import { Screen } from '@/components/Screen';
import { StrengthLeaderboard } from '@/components/StrengthLeaderboard';
import { useGymMembership, useSession } from '@/lib/auth';
import { findMovement, type Metric } from '@/lib/movements';
import {
  bestOfMerged,
  deriveTagValue,
  mergeJournal,
  type JournalRow,
  type SectionForDerivation,
  type TagInputRow,
} from '@/lib/movement-journal';
import {
  categoryLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import {
  fmtDateShort,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

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
    entries: {
      weight_numeric: number | null;
      reps: number | null;
      time_seconds: number | null;
      distance_numeric: number | null;
      calories: number | null;
    }[];
  } | null;
};

export default function MovementDetail() {
  const { movement: movementKey } = useLocalSearchParams<{ movement: string }>();
  const session = useSession();
  const meta = movementKey ? findMovement(movementKey) : undefined;
  const [recording, setRecording] = useState<{ trackKey?: string } | null>(
    null,
  );

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
        .eq('movement_key', movementKey!)
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
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(workout_id, section_category, title, section_format, total_time_seconds, total_rounds, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('profile_id', session!.user.id)
        .eq('movement_key', movementKey!)
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
      // No track_key, or scheme unknown → keep the row visible but
      // without a numeric value.
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
            onPress={() => setRecording({})}
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
              const best = bestOfMerged(merged, scheme.key, scheme);
              const display = best
                ? formatResultValue(best, scheme.metric)
                : null;
              return (
                <Pressable
                  key={scheme.key}
                  onPress={() => setRecording({ trackKey: scheme.key })}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 active:opacity-70">
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
                        Tap to log a {scheme.label.toLowerCase()}
                      </Text>
                    )}
                  </View>
                  <Text
                    className={
                      display
                        ? 'text-gray-900 dark:text-gray-50 text-lg font-semibold'
                        : 'text-gray-400 dark:text-gray-500 text-sm'
                    }>
                    {display ?? '+'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <MovementLeaderboardSection
          movementKey={movement.key}
          schemes={movement.schemes}
        />

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
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <RecordMovementResultModal
        visible={recording !== null}
        onClose={() => setRecording(null)}
        initialMovementKey={movement.key}
        initialTrackKey={recording?.trackKey}
      />
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
        <Ionicons name="trophy-outline" size={18} color="#2563EB" />
        <Text className="flex-1 text-gray-900 dark:text-gray-50 text-lg font-semibold">
          Leaderboard
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {schemes.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setActiveScheme(s.key)}
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
}: {
  row: JournalRow;
  schemeLabel: string;
  metric: Metric | undefined;
}) {
  const display = metric ? formatResultValue(row, metric) : null;
  return (
    <Pressable
      onPress={() =>
        row.workout_id
          ? router.push(`/track/workout/${row.workout_id}` as never)
          : router.push('/track/journal' as never)
      }
      className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
            {row.section_title ?? schemeLabel}
          </Text>
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
    </Pressable>
  );
}
