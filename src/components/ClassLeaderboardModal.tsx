import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Text } from './Text';

import { Sheet } from './Sheet';
import {
  formatClassScore,
  ordinal,
  type ClassLeaderboardRow,
} from '@/lib/leaderboards';
import { supabase } from '@/lib/supabase';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';

// Per-section class leaderboard. Opened from the Programming view
// for any section flagged leaderboard_enabled by the coach.
export function ClassLeaderboardModal({
  visible,
  programmingId,
  sectionIndex,
  sectionTitle,
  onClose,
}: {
  visible: boolean;
  programmingId: string | null;
  sectionIndex: number | null;
  sectionTitle: string;
  onClose: () => void;
}) {
  const weightUnit = useGymWeightUnit();
  const query = useQuery({
    queryKey: ['class-leaderboard', programmingId, sectionIndex],
    enabled: visible && !!programmingId && sectionIndex != null,
    queryFn: async (): Promise<ClassLeaderboardRow[]> => {
      const { data, error } = await supabase.rpc('class_leaderboard', {
        p_programming_id: programmingId!,
        p_section_index: sectionIndex!,
      });
      if (error) throw error;
      return (data ?? []) as ClassLeaderboardRow[];
    },
  });

  const rows = query.data ?? [];

  return (
    <Sheet
      visible={visible}
      title={sectionTitle}
      subtitle="Leaderboard"
      onClose={onClose}>
      <View className="pb-1">
        {query.isLoading ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">Loading…</Text>
        ) : rows.length === 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            No results logged yet for this section. Be the first.
          </Text>
        ) : (
          <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
            {rows.map((r, i) => (
              <View
                key={r.profile_id}
                className={`flex-row items-center gap-3 px-3.5 py-3 ${
                  i === 0 ? '' : 'border-t border-line dark:border-line-dk'
                }`}>
                <View className="w-8">
                  <Text
                    className={`text-[13px] ${
                      r.rank <= 3
                        ? 'text-ink dark:text-ink-dk font-bold'
                        : 'text-ink-3 dark:text-ink-3-dk'
                    }`}>
                    {ordinal(r.rank)}
                  </Text>
                </View>
                <Text
                  className="flex-1 text-ink dark:text-ink-dk text-[14.5px]"
                  numberOfLines={1}>
                  {r.display_name}
                </Text>
                <Text className="text-ink dark:text-ink-dk text-[14.5px] font-bold">
                  {formatClassScore(r, weightUnit)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}
