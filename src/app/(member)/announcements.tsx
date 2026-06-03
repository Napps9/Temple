import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type Announcement = {
  announcement_id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  announcement_reads: { read_at: string }[];
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function Announcements() {
  const session = useSession();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['announcements', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Announcement[]> => {
      // Pull all announcements at the member's gyms; RLS handles
      // tenant filtering. announcement_reads is left-joined to a
      // single row when the member has read it.
      const { data, error } = await supabase
        .from('announcements')
        .select(
          'announcement_id, title, body, pinned, published_at, expires_at, announcement_reads!left(read_at)',
        )
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Announcement[];
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!session) return;
      const { error } = await supabase
        .from('announcement_reads')
        .upsert({ announcement_id: announcementId, profile_id: session.user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', session?.user.id] });
    },
  });

  const items = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const unreadCount = items.filter((a) => a.announcement_reads.length === 0).length;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Announcements
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {unreadCount > 0
              ? `${unreadCount} new`
              : 'Up to date — check back for news from your coach.'}
          </Text>
        </View>

        {listQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {items.length === 0 && !listQuery.isLoading ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              Nothing yet.
            </Text>
          </View>
        ) : null}

        {items.map((a) => {
          const isUnread = a.announcement_reads.length === 0;
          return (
            <Pressable
              key={a.announcement_id}
              onPress={() => {
                if (isUnread) markReadMutation.mutate(a.announcement_id);
              }}
              className={`bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 ${
                isUnread ? 'border border-primary' : ''
              }`}>
              <View className="flex-row items-center gap-2">
                {a.pinned ? (
                  <Ionicons name="pin" size={14} color="#6B7280" />
                ) : null}
                {isUnread ? (
                  <View className="w-2 h-2 rounded-full bg-primary" />
                ) : null}
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  {a.title}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {fmtDate(a.published_at)}
                </Text>
              </View>
              <Text className="text-gray-700 dark:text-gray-200">{a.body}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
