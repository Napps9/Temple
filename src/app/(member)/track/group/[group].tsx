import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
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
import { formatResultValue, type TrackedResultRow } from '@/lib/track';

type RawTagRow = {
  id: string;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  section: {
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

export default function GroupPage() {
  const { group: groupKey } = useLocalSearchParams<{ group: string }>();
  const session = useSession();
  const group = groupKey ? findGroup(groupKey) : undefined;

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
          'id, movement_key, track_key, performed_at, notes, section:tracked_workout_sections(section_format, total_time_seconds, total_rounds, entries:tracked_section_entries(weight_numeric, reps, time_seconds, distance_numeric, calories))',
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
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
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
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <Link href="/track" asChild>
            <Pressable hitSlop={6} className="active:opacity-70">
              <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
            </Pressable>
          </Link>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {group.name}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
              ? formatResultValue(best, headlineScheme.metric)
              : null;
            return (
              <Pressable
                key={m.key}
                onPress={() =>
                  router.push(`/track/movement/${m.key}` as never)
                }
                className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 active:opacity-70">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {m.name}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {headlineScheme.label}
                  </Text>
                </View>
                <View className="items-end">
                  <Text
                    className={
                      display
                        ? 'text-gray-900 dark:text-gray-50 font-semibold'
                        : 'text-gray-400 dark:text-gray-500 text-sm'
                    }>
                    {display ?? '—'}
                  </Text>
                  {merged.length > 0 ? (
                    <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
                      {merged.length} logged
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
