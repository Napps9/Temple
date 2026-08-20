import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { ReceiptLine } from '@/components/TimelineLines';
import { supabase } from '@/lib/supabase';
import { dedupeClosures, type TimelineEvent } from '@/lib/timeline';
import { dayStart, nextDayStart, QUIET_PAST_DAY } from '@/lib/timeline-day';

// One past day of the Timeline, read as its own thread. The feed's
// p_before cursor is a strict `<` with no tiebreaker, so pages are cut
// at day boundaries — a window can't lose a row to an equal timestamp
// the way a chained cursor can.
//
// A past day is the record of what SURVIVES, not a replay: a decided
// membership request, a recovered payment and a claimed cover offer
// have all left the feed, so their lines are simply absent here. What
// remains renders as plain receipt lines — the "record vs work" split,
// applied to pages: work lives on today only.
//
// Accepted v1 limits: a day with more than 200 events loses its
// earliest lines (the feed's hard cap), and each fetch costs the server
// a full-history scan (no per-branch limit pushdown) — per-day caching
// keeps that to one scan per visited day per five minutes.
function useTimelineDay(gymId: string | undefined, dayKey: string) {
  return useQuery({
    queryKey: ['timeline-day', gymId, dayKey],
    enabled: !!gymId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TimelineEvent[]> => {
      const { data, error } = await supabase.rpc('timeline_feed', {
        p_gym_id: gymId!,
        p_before: nextDayStart(dayKey).toISOString(),
        p_limit: 200,
      });
      if (error) throw error;
      const floor = dayStart(dayKey).toISOString();
      return ((data ?? []) as TimelineEvent[]).filter(
        (e) => e.occurred_at >= floor,
      );
    },
  });
}

export function TimelinePastDay({
  gymId,
  dayKey,
}: {
  gymId: string | undefined;
  dayKey: string;
}) {
  const day = useTimelineDay(gymId, dayKey);
  const events = [...dedupeClosures(day.data ?? [])].sort((a, b) =>
    a.occurred_at < b.occurred_at ? -1 : 1,
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"
      refreshControl={
        <RefreshControl
          refreshing={day.isRefetching}
          onRefresh={() => day.refetch()}
        />
      }>
      {day.isLoading ? (
        <View className="py-16 items-center">
          <ActivityIndicator />
        </View>
      ) : events.length === 0 ? (
        <View className="py-16 px-6 items-center">
          <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
            {QUIET_PAST_DAY}
          </Text>
        </View>
      ) : (
        events.map((e) => <ReceiptLine key={e.item_id} event={e} />)
      )}
    </ScrollView>
  );
}
