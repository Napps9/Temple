import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { router } from 'expo-router';

import { findMovement, findScheme } from '@/lib/movements';
import { formatWeight } from '@/lib/weight';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import {
  categoryLabel,
  formatLabel,
  type SectionCategoryKey,
  type SectionFormatKey,
} from '@/lib/programming';
import { formatSeconds } from '@/lib/track';
import { aggregateHeadline, FORMAT_SHAPES } from '@/lib/track-sections';

// Rich workout-section card: programmed body in a primary-tinted
// left-accent block, headline result, per-entry breakdown, tagged
// movement chips. Used both on the standalone workout detail page
// (`/track/workout/[id]`) and as journal previews on the Track home
// page so the same level of context shows in both places.

export type SectionEntryShape = {
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

export type SectionTagShape = {
  movement_key: string;
  track_key: string | null;
};

export type WorkoutSectionShape = {
  id: string;
  section_category: SectionCategoryKey;
  section_format: SectionFormatKey;
  title: string | null;
  body: string | null;
  notes: string | null;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  total_distance_m: number | null;
  total_calories: number | null;
  did_not_finish: boolean | null;
  free_text_result: string | null;
  entries: SectionEntryShape[];
  tags: SectionTagShape[];
};

export function WorkoutSectionCard({
  section,
}: {
  section: WorkoutSectionShape;
}) {
  const headline = renderHeadline(section);
  const programmed = section.body?.trim();
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
          {section.title?.trim() || categoryLabel(section.section_category)}
        </Text>
        <View className="rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
          <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold uppercase tracking-wider">
            {formatLabel(section.section_format)}
          </Text>
        </View>
      </View>

      {programmed ? (
        <View className="bg-primary/5 border-l-2 border-primary rounded-r-lg px-3 py-2">
          <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] uppercase tracking-widest mb-1">
            Programmed
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-snug">
            {programmed}
          </Text>
        </View>
      ) : null}

      {headline ? (
        <View className="flex-row items-baseline gap-2">
          <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] uppercase tracking-widest">
            Result
          </Text>
          <Text className="flex-1 text-ink dark:text-ink-dk text-lg font-semibold">
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
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs italic">
          {section.notes}
        </Text>
      ) : null}
    </View>
  );
}

function renderHeadline(section: WorkoutSectionShape): string | null {
  const shape = FORMAT_SHAPES[section.section_format];
  if (shape.kind === 'notes_only') {
    return section.free_text_result?.trim() || null;
  }
  return aggregateHeadline(section);
}

function EntryLine({
  entry,
  format,
}: {
  entry: SectionEntryShape;
  format: SectionFormatKey;
}) {
  const weightUnit = useGymWeightUnit();
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
      formatWeight(entry.weight_numeric, weightUnit),
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
      <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] uppercase tracking-wider w-20">
        {entry.label?.trim() || `${labelBase} ${idx}`}
      </Text>
      <Text className="flex-1 text-ink dark:text-ink-dk text-xs">
        {pieces.length > 0 ? pieces.join(' · ') : '—'}
      </Text>
    </View>
  );
}
