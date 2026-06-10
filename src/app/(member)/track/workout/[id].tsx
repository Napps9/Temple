import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { findMovement, findScheme } from '@/lib/movements';
import {
  categoryLabel,
  formatLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import {
  fmtDateLong,
  formatResultValue,
  formatSeconds,
  type TrackedResultRow,
} from '@/lib/track';
import { FORMAT_SHAPES } from '@/lib/track-sections';

// Tap any journal row (movement page, journal preview, group page)
// and land here: the full recorded workout for that day, with the
// programmed section bodies visible above each set of results.

type SectionEntryRow = {
  id: string;
  entry_index: number;
  round_index: number | null;
  label: string | null;
  weight_numeric: number | null;
  weight_unit: string | null;
  reps: number | null;
  time_seconds: number | null;
  distance_numeric: number | null;
  distance_unit: string | null;
  calories: number | null;
  done: boolean | null;
  notes: string | null;
};

type TagRow = {
  movement_key: string;
  track_key: string | null;
};

type SectionRow = {
  id: string;
  section_category: SectionCategoryKey;
  section_format: SectionFormatKey;
  title: string | null;
  body: string | null;
  notes: string | null;
  sort_order: number;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  did_not_finish: boolean | null;
  free_text_result: string | null;
  source_programming_id: string | null;
  entries: SectionEntryRow[];
  tags: TagRow[];
};

type WorkoutRow = {
  id: string;
  performed_at: string;
  title: string | null;
  notes: string | null;
  class_session_id: string | null;
  sections: SectionRow[];
  legacy_results: TrackedResultRow[];
};

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();

  const workout = useQuery({
    queryKey: ['tracked-workout', session?.user.id, id],
    enabled: !!session?.user.id && !!id,
    queryFn: async (): Promise<WorkoutRow | null> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          [
            'id, performed_at, title, notes, class_session_id',
            'sections:tracked_workout_sections(id, section_category, section_format, title, body, notes, sort_order, total_time_seconds, total_rounds, total_extra_reps, did_not_finish, free_text_result, source_programming_id, entries:tracked_section_entries(id, entry_index, round_index, label, weight_numeric, weight_unit, reps, time_seconds, distance_numeric, distance_unit, calories, done, notes), tags:tracked_section_movement_tags(movement_key, track_key))',
            'legacy_results:tracked_movement_results(id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at)',
          ].join(', '),
        )
        .eq('profile_id', session!.user.id)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const w = data as unknown as WorkoutRow;
      return {
        ...w,
        sections: (w.sections ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      };
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={6}
            className="active:opacity-70">
            <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
              Session
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {workout.data?.title?.trim() || 'Workout'}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {workout.data ? fmtDateLong(workout.data.performed_at) : ''}
            </Text>
          </View>
        </View>

        {workout.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : !workout.data ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Workout not found.
            </Text>
          </View>
        ) : (
          <>
            {workout.data.sections.map((s) => (
              <SectionCard key={s.id} section={s} />
            ))}
            {workout.data.legacy_results.length > 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Results
                </Text>
                {workout.data.legacy_results.map((r) => (
                  <ResultRow key={r.id} row={r} />
                ))}
              </View>
            ) : null}
            {workout.data.notes ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
                <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
                  Notes
                </Text>
                <Text className="text-gray-700 dark:text-gray-200 text-sm">
                  {workout.data.notes}
                </Text>
              </View>
            ) : null}
            {workout.data.sections.length === 0 &&
            workout.data.legacy_results.length === 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  No results recorded.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SectionCard({ section }: { section: SectionRow }) {
  const headline = renderHeadline(section);
  const programmed = section.body?.trim();
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          {section.title?.trim() || categoryLabel(section.section_category)}
        </Text>
        <View className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5">
          <Text className="text-gray-600 dark:text-gray-300 text-[10px] font-semibold uppercase tracking-wider">
            {formatLabel(section.section_format)}
          </Text>
        </View>
      </View>

      {programmed ? (
        <View className="bg-primary/5 border-l-2 border-primary rounded-r-lg px-3 py-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest mb-1">
            Programmed
          </Text>
          <Text className="text-gray-700 dark:text-gray-200 text-sm leading-snug">
            {programmed}
          </Text>
        </View>
      ) : null}

      {headline ? (
        <View className="flex-row items-baseline gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
            Result
          </Text>
          <Text className="flex-1 text-gray-900 dark:text-gray-50 text-lg font-semibold">
            {headline}
          </Text>
        </View>
      ) : null}

      {section.entries.length > 0 ? (
        <View className="gap-1">
          {section.entries
            .slice()
            .sort((a, b) => a.entry_index - b.entry_index)
            .map((e) => (
              <EntryLine
                key={e.id}
                entry={e}
                format={section.section_format}
              />
            ))}
        </View>
      ) : null}

      {section.tags.length > 0 ? (
        <View className="flex-row flex-wrap gap-1">
          {section.tags.map((t, i) => {
            const meta = findMovement(t.movement_key);
            const scheme = t.track_key
              ? findScheme(t.movement_key, t.track_key)
              : null;
            const name = meta?.movement.name ?? t.movement_key;
            return (
              <Pressable
                key={`${t.movement_key}-${t.track_key}-${i}`}
                onPress={() =>
                  meta &&
                  router.push(`/track/movement/${meta.movement.key}` as never)
                }
                className="rounded-full bg-primary/10 px-2.5 py-1 active:opacity-70">
                <Text className="text-primary text-[11px] font-semibold">
                  {name}
                  {scheme ? ` · ${scheme.label}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {section.notes ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs italic">
          {section.notes}
        </Text>
      ) : null}
    </View>
  );
}

function renderHeadline(section: SectionRow): string | null {
  const shape = FORMAT_SHAPES[section.section_format];
  if (shape.kind === 'notes_only') {
    return section.free_text_result?.trim() || null;
  }
  if (shape.kind === 'aggregate_first') {
    const parts: string[] = [];
    if (section.total_time_seconds != null) {
      parts.push(formatSeconds(section.total_time_seconds));
    }
    if (section.total_rounds != null) {
      const r = `${section.total_rounds} round${section.total_rounds === 1 ? '' : 's'}`;
      const e =
        section.total_extra_reps && section.total_extra_reps > 0
          ? ` + ${section.total_extra_reps} reps`
          : '';
      parts.push(r + e);
    }
    if (section.did_not_finish) parts.push('DNF');
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}

function EntryLine({
  entry,
  format,
}: {
  entry: SectionEntryRow;
  format: SectionFormatKey;
}) {
  const labelBase =
    format === 'amrap'
      ? 'Round'
      : format === 'emom'
        ? 'Minute'
        : format === 'intervals'
          ? 'Interval'
          : 'Set';
  const idx = entry.round_index ?? entry.entry_index;
  const pieces: string[] = [];
  if (entry.weight_numeric != null) {
    pieces.push(
      `${entry.weight_numeric}${entry.weight_unit ? ' ' + entry.weight_unit : ''}`,
    );
  }
  if (entry.reps != null) pieces.push(`${entry.reps} reps`);
  if (entry.time_seconds != null) pieces.push(formatSeconds(entry.time_seconds));
  if (entry.distance_numeric != null) {
    pieces.push(
      `${entry.distance_numeric}${entry.distance_unit ? ' ' + entry.distance_unit : ''}`,
    );
  }
  if (entry.calories != null) pieces.push(`${entry.calories} cal`);
  if (entry.done) pieces.push('done');
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-wider w-20">
        {entry.label?.trim() || `${labelBase} ${idx}`}
      </Text>
      <Text className="flex-1 text-gray-900 dark:text-gray-50 text-xs">
        {pieces.length > 0 ? pieces.join(' · ') : '—'}
      </Text>
    </View>
  );
}

function ResultRow({ row }: { row: TrackedResultRow }) {
  const meta = findMovement(row.movement_key);
  const scheme = findScheme(row.movement_key, row.track_key);
  const movementName = meta?.movement.name ?? row.movement_key;
  const schemeLabel = scheme?.label ?? row.track_key;
  const display = scheme ? formatResultValue(row, scheme.metric) : null;
  return (
    <Pressable
      onPress={() =>
        meta && router.push(`/track/movement/${meta.movement.key}` as never)
      }
      className="flex-row items-center gap-3 active:opacity-70">
      <View className="flex-1">
        <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
          {movementName}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {schemeLabel}
          {row.notes ? ` · ${row.notes}` : ''}
        </Text>
      </View>
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {display ?? '—'}
      </Text>
    </Pressable>
  );
}
