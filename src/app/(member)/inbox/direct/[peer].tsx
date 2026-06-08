import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  groupByDay,
  type DirectMessageRow,
} from '@/lib/messaging';
import { supabase } from '@/lib/supabase';

export default function DirectThread() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const peerProfile = useQuery({
    queryKey: ['profile', peer],
    enabled: !!peer,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', peer!)
        .single();
      if (err) throw err;
      return data as { full_name: string | null; avatar_url: string | null };
    },
  });

  const messages = useQuery({
    queryKey: ['dm-thread', session?.user.id, peer],
    enabled: !!session?.user.id && !!peer,
    queryFn: async (): Promise<DirectMessageRow[]> => {
      const me = session!.user.id;
      const { data, error: err } = await supabase
        .from('direct_messages')
        .select('id, gym_id, sender_id, recipient_id, body, created_at, read_at')
        .or(
          `and(sender_id.eq.${me},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${me})`,
        )
        .order('created_at', { ascending: true });
      if (err) throw err;
      return (data ?? []) as DirectMessageRow[];
    },
  });

  // Mark everything from the peer as read when we open / refresh the
  // thread. Best-effort; ignore errors.
  useEffect(() => {
    if (!peer || !session?.user.id) return;
    supabase
      .rpc('mark_dm_thread_read', { p_peer_id: peer })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['dm-inbox'] });
        queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
      });
  }, [peer, session?.user.id, messages.data?.length, queryClient]);

  const send = useMutation({
    mutationFn: async () => {
      if (!session || !membership) throw new Error('Missing context');
      const body = draft.trim();
      if (!body) throw new Error('Type a message first');
      const { error: err } = await supabase.from('direct_messages').insert({
        gym_id: membership.gymId,
        sender_id: session.user.id,
        recipient_id: peer!,
        body,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setDraft('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['dm-thread'] });
      queryClient.invalidateQueries({ queryKey: ['dm-inbox'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not send')),
  });

  const grouped = groupByDay(messages.data ?? []);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="flex-1 md:max-w-2xl md:mx-auto md:w-full py-6">
        <View className="flex-row items-center gap-3 px-2 pb-3">
          <Link href="/inbox" asChild>
            <Pressable hitSlop={6} className="active:opacity-70">
              <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
            </Pressable>
          </Link>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              {peerProfile.data?.full_name?.trim() || 'Member'}
            </Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-3 px-2 pb-3">
          {messages.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Loading…
            </Text>
          ) : grouped.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No messages yet. Say hi.
              </Text>
            </View>
          ) : (
            grouped.map((group) => (
              <View key={group.key} className="gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest text-center">
                  {group.label}
                </Text>
                {group.rows.map((m) => {
                  const fromMe = m.sender_id === session?.user.id;
                  return (
                    <View
                      key={m.id}
                      className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                        fromMe
                          ? 'self-end bg-primary'
                          : 'self-start bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700'
                      }`}>
                      <Text
                        className={
                          fromMe
                            ? 'text-white text-sm'
                            : 'text-gray-900 dark:text-gray-50 text-sm'
                        }>
                        {m.body}
                      </Text>
                      <Text
                        className={
                          fromMe
                            ? 'text-white/70 text-[10px] mt-1 text-right'
                            : 'text-gray-400 dark:text-gray-500 text-[10px] mt-1'
                        }>
                        {new Date(m.created_at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        <View className="flex-row items-end gap-2 px-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            placeholderTextColor="#9CA3AF"
            multiline
            className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
            style={{ minHeight: 44, maxHeight: 120 }}
          />
          <Pressable
            onPress={() => send.mutate()}
            disabled={!draft.trim() || send.isPending}
            className={`w-11 h-11 rounded-full items-center justify-center ${
              !draft.trim() || send.isPending
                ? 'bg-gray-200 dark:bg-gray-700'
                : 'bg-primary active:bg-primary-dark'
            }`}>
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-xs px-3 pt-1">
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
