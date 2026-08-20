import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { findGroup } from '@/lib/movements';
import {
  bestOfMerged,
  deriveTagValue,
  mergeJournal,
  type SectionForDerivation,
  type TagInputRow,
} from '@/lib/movement-journal';
import type { SectionFormatKey } from '@/lib/programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { formatResultValue, type TrackedResultRow } from '@/lib/track';
import { useMarkGroupViewed } from '@/lib/useGroupViewed';

type RawTagRow = {
  id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  section: {
    workout_id: string | null;
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

export default function GroupPage() {
  const weightUnit = useGymWeightUnit();
  const colors = useThemeColors();
  const { group: groupKey } = useLocalSearchParams<{ group: string }>();
  const session = useSession();
  const group = groupKey ? findGroup(groupKey) : undefined;
  const markViewed = useMarkGroupViewed();

  // Visiting the group clears its "N new" badge on Track-home.
  useEffect(() => {
    if (group) {
      void markViewed(group.key);
    }
  }, [group, markViewed]);

  const movementKeys = useMemo(
    () => group?.movements.map((m) => m.key) ?? [],
    [group],
  );

  const direct = useQuery({
    queryKey: [
      'tracked-results-by-group',
      session?.user.id,
      groupKey,
      movementKeys.join(','),
    ],
    enabled: !!session?.user.id && movementKeys.length > 0,
    queryFn: async (): Promise<TrackedResultRow[]> => {
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'id, workout_id, movement_key, track_key, value_numeric, value_seconds, value_unit, notes, performed_at',
        )
        .eq('profile_id', session!.user.id)
        .in('movement_key', movementKeys)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackedResultRow[];
    },
  });

  const tags = useQuery({
    queryKey: [
      'tracked-tags-by-group',
      session?.user.id,
      groupKey,
      movementKeys.join(','),
    ],
    enabled: !!session?.user.id && movementKeys.length > 0,
    queryFn: async (): Promise<RawTagRow[]> => {
      const { data, error } = await supabase
        .from('tracked_section_movement_tags')
        .select(
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(workout_id, section_format, total_time_seconds, total_rounds, total_distance_m, total_calories, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
        )
        .eq('profile_id', session!.user.id)
        .in('movement_key', movementKeys);
      if (error) throw error;
      return (data ?? []) as unknown as RawTagRow[];
    },
  });

  if (!group) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk mt-8">
          Unknown movement group.
        </Text>
      </Screen>
    );
  }

  // Build a per-movement merged journal so the headline best-of reads
  // from direct + tag rows together.
  const mergedByMovement = new Map<string, ReturnType<typeof mergeJournal>>();
  for (const m of group.movements) {
    const directRows = (direct.data ?? [])
      .filter((r) => r.movement_key === m.key)
      .map((r) => ({
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
    const tagRows: TagInputRow[] = (tags.data ?? [])
      .filter((t) => t.movement_key === m.key)
      .map((t) => {
        const scheme = t.track_key
          ? m.schemes.find((s) => s.key === t.track_key)
          : undefined;
        const derived =
          scheme && t.section
            ? deriveTagValue(scheme, t.section as SectionForDerivation)
            : { value_numeric: null, value_seconds: null };
        return {
          id: t.id,
          workout_id: t.section?.workout_id ?? null,
          // The group page doesn't display per-row section context, but
          // the field is required by TagInputRow's shape.
          section_title: null,
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
    mergedByMovement.set(m.key, mergeJournal(directRows, tagRows));
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline fallbackHref="/track" />
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
              {group.name}
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {group.blurb}
            </Text>
          </View>
        </View>

        <View className="gap-2">
          {group.movements.map((m) => {
            const merged = mergedByMovement.get(m.key) ?? [];
            // Use the headline scheme — typically 1RM — as the badge.
            const headlineScheme = m.schemes[0];
            const best = bestOfMerged(merged, headlineScheme.key, headlineScheme);
            const display = best
              ? formatResultValue(best, headlineScheme.metric, weightUnit)
              : null;
            return (
              <Pressable
                key={m.key}
                onPress={() =>
                  router.push(`/track/movement/${m.key}` as never)
                }
                className="bg-surface dark:bg-surface-dk rounded-xl p-4 flex-row items-center gap-3 shadow-card active:opacity-70">
                <View className="flex-1">
                  <Text className="text-ink dark:text-ink-dk font-semibold">
                    {m.name}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {headlineScheme.label}
                  </Text>
                </View>
                <View className="items-end">
                  <Text
                    className={
                      display
                        ? 'text-ink dark:text-ink-dk font-semibold'
                        : 'text-ink-3 dark:text-ink-3-dk text-sm'
                    }>
                    {display ?? '—'}
                  </Text>
                  {merged.length > 0 ? (
                    <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] uppercase tracking-widest">
                      {merged.length} logged
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
