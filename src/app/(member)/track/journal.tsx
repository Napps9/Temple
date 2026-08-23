import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PageHead } from '@/components/PageHead';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { EmptyState } from '@/components/EmptyState';
import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { formatWeight } from '@/lib/weight';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { findMovement, findScheme } from '@/lib/movements';
import {
  formatLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import {
  fmtDateLong,
  formatResultValue,
  formatSeconds,
  type TrackedResultRow,
} from '@/lib/track';
import { aggregateHeadline, FORMAT_SHAPES } from '@/lib/track-sections';

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
  total_distance_m: number | null;
  total_calories: number | null;
  did_not_finish: boolean | null;
  free_text_result: string | null;
  entries: SectionEntryRow[];
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

export default function Journal() {
  const colors = useThemeColors();
  const session = useSession();
  const [recording, setRecording] = useState(false);

  const journal = useQuery({
    queryKey: ['tracked-journal', session?.user.id, 'all'],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<WorkoutRow[]> => {
      const { data, error } = await supabase
        .from('tracked_workouts')
        .select(
          [
            'id, performed_at, title, notes, class_session_id',
            'sections:tracked_workout_sections(id, section_category, section_format, title, body, notes, sort_order, total_time_seconds, total_rounds, total_extra_reps, total_distance_m, total_calories, did_not_finish, free_text_result, entries:tracked_section_entries(id, entry_index, round_index, label, weight_numeric, weight_unit, reps, time_seconds, distance_numeric, distance_unit, calories, done, notes))',
            'legacy_results:tracked_movement_results(id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at)',
          ].join(', '),
        )
        .eq('profile_id', session!.user.id)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as WorkoutRow[]).map((w) => ({
        ...w,
        sections: (w.sections ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      }));
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <PageHead
          lead={<BackLink inline fallbackHref="/track" />}
          title="Journal"
          subtitle="Every workout you've logged."
          action={
            <Pressable
              onPress={() => setRecording(true)}
              hitSlop={6}
              className="bg-primary active:bg-primary-dark rounded-full px-3 py-1.5 flex-row items-center gap-1">
              <Ionicons name="add" size={14} color={colors.onPrimary} />
              <Text className="text-on-primary text-xs font-semibold">Record</Text>
            </Pressable>
          }
        />

        {journal.isLoading ? (
          <EmptyState kind="loading" />
        ) : (journal.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            description="Log a session and it lands here, PRs and all."
            actionLabel="Record a workout"
            onAction={() => setRecording(true)}
          />
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

function WorkoutCard({ workout }: { workout: WorkoutRow }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() =>
        router.push(`/track/workout/${workout.id}` as never)
      }
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 active:opacity-70">
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            {workout.title?.trim() || 'Workout'}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {fmtDateLong(workout.performed_at)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
      </View>

      {workout.sections.length > 0 ? (
        <View className="gap-3">
          {workout.sections.map((s) => (
            <SectionDisplay key={s.id} section={s} />
          ))}
        </View>
      ) : null}

      {workout.legacy_results.length > 0 ? (
        <View className="gap-2">
          {workout.legacy_results.map((r) => (
            <ResultRow key={r.id} row={r} />
          ))}
        </View>
      ) : null}

      {workout.sections.length === 0 && workout.legacy_results.length === 0 ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs italic">
          No results recorded.
        </Text>
      ) : null}

      {workout.notes ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          {workout.notes}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SectionDisplay({ section }: { section: SectionRow }) {
  const headline = renderHeadline(section);
  return (
    <View className="bg-raised dark:bg-raised-dk rounded-lg p-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold text-sm" numberOfLines={1}>
          {section.title?.trim() || formatLabel(section.section_format)}
        </Text>
        <View className="rounded-full bg-surface dark:bg-surface-dk border border-line dark:border-line-dk px-2 py-0.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold uppercase tracking-wider">
            {formatLabel(section.section_format)}
          </Text>
        </View>
      </View>
      {section.body ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {section.body}
        </Text>
      ) : null}
      {headline ? (
        <Text className="text-ink dark:text-ink-dk font-medium text-sm">
          {headline}
        </Text>
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
      {section.notes ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs italic">
          {section.notes}
        </Text>
      ) : null}
    </View>
  );
}

function renderHeadline(section: SectionRow): string | null {
  const shape = FORMAT_SHAPES[section.section_format];
  if (shape.kind === 'notes_only') {
    return section.free_text_result?.trim() || (section.notes ? null : '—');
  }
  return aggregateHeadline(section);
}

function EntryLine({
  entry,
  format,
}: {
  entry: SectionEntryRow;
  format: SectionFormatKey;
}) {
  const weightUnit = useGymWeightUnit();
  const labelBase = format === 'amrap' ? 'Round' : format === 'emom' ? 'Minute' : format === 'intervals' ? 'Interval' : 'Set';
  const idx = entry.round_index ?? entry.entry_index;
  const pieces: string[] = [];
  if (entry.weight_numeric != null) {
    pieces.push(formatWeight(entry.weight_numeric, weightUnit));
  }
  if (entry.reps != null) pieces.push(`${entry.reps} reps`);
  if (entry.time_seconds != null) pieces.push(formatSeconds(entry.time_seconds));
  if (entry.distance_numeric != null) {
    pieces.push(`${entry.distance_numeric}${entry.distance_unit ? ' ' + entry.distance_unit : ''}`);
  }
  if (entry.calories != null) pieces.push(`${entry.calories} cal`);
  if (entry.done) pieces.push('done');
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] uppercase tracking-wider w-20">
        {entry.label?.trim() || `${labelBase} ${idx}`}
      </Text>
      <Text className="flex-1 text-ink dark:text-ink-dk text-xs">
        {pieces.length > 0 ? pieces.join(' · ') : '—'}
      </Text>
    </View>
  );
}

function ResultRow({ row }: { row: TrackedResultRow }) {
  const weightUnit = useGymWeightUnit();
  const meta = findMovement(row.movement_key);
  const scheme = findScheme(row.movement_key, row.track_key);
  const movementName = meta?.movement.name ?? row.movement_key;
  const schemeLabel = scheme?.label ?? row.track_key;
  const display = scheme ? formatResultValue(row, scheme.metric, weightUnit) : null;
  return (
    <Pressable
      onPress={() =>
        meta && router.push(`/track/movement/${meta.movement.key}` as never)
      }
      className="flex-row items-center gap-3 active:opacity-70">
      <View className="flex-1">
        <Text className="text-ink dark:text-ink-dk text-sm font-medium">
          {movementName}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {schemeLabel}
          {row.notes ? ` · ${row.notes}` : ''}
        </Text>
      </View>
      <Text className="text-ink dark:text-ink-dk font-semibold">
        {display ?? '—'}
      </Text>
    </Pressable>
  );
}
