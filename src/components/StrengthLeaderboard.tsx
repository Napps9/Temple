import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { useGymMembership } from '@/lib/auth';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import {
  formatStrengthValue,
  ordinal,
  type StrengthLeaderboardRow,
} from '@/lib/leaderboards';
import type { Scheme } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { fmtDateShort } from '@/lib/track';

// Reusable strength leaderboard list. Drops into Movement detail pages
// or a leaderboards index. limit controls how many rows render — pass
// 5 for a teaser, leave undefined for the full list.
export function StrengthLeaderboard({
  movementKey,
  scheme,
  limit,
}: {
  movementKey: string;
  scheme: Scheme;
  limit?: number;
}) {
  const { data: membership } = useGymMembership();
  const weightUnit = useGymWeightUnit();

  const query = useQuery({
    queryKey: [
      'strength-leaderboard',
      membership?.gymId,
      movementKey,
      scheme.key,
    ],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<StrengthLeaderboardRow[]> => {
      const { data, error } = await supabase.rpc('strength_leaderboard', {
        p_gym_id: membership!.gymId,
        p_movement_key: movementKey,
        p_track_key: scheme.key,
        p_metric: scheme.metric,
        p_better: scheme.better,
      });
      if (error) throw error;
      return (data ?? []) as StrengthLeaderboardRow[];
    },
  });

  if (query.isLoading) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
    );
  }

  const rows = query.data ?? [];
  const shown = limit != null ? rows.slice(0, limit) : rows;

  if (rows.length === 0) {
    return (
      <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          No {scheme.label.toLowerCase()} results in the gym yet.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-1.5">
      {shown.map((r) => (
        <View
          key={r.profile_id}
          className="flex-row items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <View className="w-9 items-center">
            <Text
              className={
                r.rank <= 3
                  ? 'text-primary font-bold text-sm'
                  : 'text-gray-500 dark:text-gray-400 text-sm'
              }>
              {ordinal(r.rank)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-sm">
              {r.display_name}
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
              {fmtDateShort(r.performed_at)}
              {r.source === 'tag' ? ' · from session' : ''}
            </Text>
          </View>
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {formatStrengthValue(r, scheme.metric, weightUnit)}
          </Text>
        </View>
      ))}
      {limit != null && rows.length > limit ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs italic pt-1">
          +{rows.length - limit} more
        </Text>
      ) : null}
    </View>
  );
}
