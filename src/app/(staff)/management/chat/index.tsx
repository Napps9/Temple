import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type ThreadRow = {
  thread_id: string;
  profile_id: string;
  last_message_at: string | null;
  last_staff_read_at: string | null;
  profiles: { full_name: string | null } | null;
};

function fmtAgo(iso: string | null): string {
  if (!iso) return 'no messages';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function StaffChatList() {
  const { data: gym } = useGymMembership();

  const threadsQuery = useQuery({
    queryKey: ['staff-chat-threads', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<ThreadRow[]> => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select(
          'thread_id, profile_id, last_message_at, last_staff_read_at, profiles!chat_threads_profile_id_fkey(full_name)',
        )
        .eq('gym_id', gym!.gymId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ThreadRow[];
    },
  });

  const threads = threadsQuery.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-3 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Chat
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Conversations with members.
          </Text>
        </View>

        {threadsQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {!threadsQuery.isLoading && threads.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400">
              No conversations yet. Members start chats from the app.
            </Text>
          </View>
        ) : null}

        {threads.map((t) => {
          const name = Array.isArray(t.profiles)
            ? t.profiles[0]?.full_name ?? 'Member'
            : t.profiles?.full_name ?? 'Member';
          const isUnread =
            t.last_message_at &&
            (!t.last_staff_read_at ||
              new Date(t.last_staff_read_at).getTime() <
                new Date(t.last_message_at).getTime());
          return (
            <Link key={t.thread_id} href={`/management/chat/${t.thread_id}`} asChild>
              <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    {isUnread ? (
                      <View className="w-2 h-2 rounded-full bg-primary" />
                    ) : null}
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                      {name}
                    </Text>
                  </View>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {fmtAgo(t.last_message_at)}
                  </Text>
                </View>
                <Text className="text-primary">→</Text>
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
