import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import {
  WorkoutSectionCard,
  type WorkoutSectionShape,
} from '@/components/WorkoutSectionCard';
import { useSession } from '@/lib/auth';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { findMovement, findScheme } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import {
  fmtDateLong,
  formatResultValue,
  type TrackedResultRow,
} from '@/lib/track';

// Tap any journal row (movement page, journal preview, group page)
// and land here: the full recorded workout for that day, with the
// programmed section bodies visible above each set of results.

type SectionRow = WorkoutSectionShape & {
  sort_order: number;
  source_programming_id: string | null;
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
            'sections:tracked_workout_sections(id, section_category, section_format, title, body, notes, sort_order, total_time_seconds, total_rounds, total_extra_reps, total_distance_m, total_calories, did_not_finish, free_text_result, source_programming_id, entries:tracked_section_entries(id, entry_index, round_index, label, weight_numeric, weight_unit, reps, time_seconds, distance_numeric, distance_unit, calories, done, notes), tags:tracked_section_movement_tags(movement_key, track_key))',
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
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline preferBack fallbackHref="/track/journal" />
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
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Workout not found.
            </Text>
          </View>
        ) : (
          <>
            {workout.data.sections.map((s) => (
              <WorkoutSectionCard key={s.id} section={s} />
            ))}
            {workout.data.legacy_results.length > 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 shadow-card">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Results
                </Text>
                {workout.data.legacy_results.map((r) => (
                  <ResultRow key={r.id} row={r} />
                ))}
              </View>
            ) : null}
            {workout.data.notes ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 shadow-card">
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
