import { useQuery } from '@tanstack/react-query';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import {
  formatClassScore,
  ordinal,
  type ClassLeaderboardRow,
} from '@/lib/leaderboards';
import { supabase } from '@/lib/supabase';

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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md gap-3 max-h-[85vh]">
          <View>
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
              Leaderboard
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              {sectionTitle}
            </Text>
          </View>

          {query.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
          ) : rows.length === 0 ? (
            <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No results logged yet for this section. Be the first.
              </Text>
            </View>
          ) : (
            <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-1.5">
              {rows.map((r) => (
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
                  <Text className="flex-1 text-gray-900 dark:text-gray-50 text-sm">
                    {r.display_name}
                  </Text>
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {formatClassScore(r)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}

          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
