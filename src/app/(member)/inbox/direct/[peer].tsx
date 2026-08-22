import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { useThemeColors } from '@/lib/theme';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  groupByDay,
  type DirectMessageRow,
} from '@/lib/messaging';
import { supabase } from '@/lib/supabase';

export default function DirectThread() {
  const colors = useThemeColors();
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
      <View className="flex-1 px-4 md:max-w-2xl md:mx-auto md:w-full py-6">
        <View className="flex-row items-center gap-3 px-2 pb-3">
          <BackLink inline fallbackHref="/inbox" />
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              {peerProfile.data?.full_name?.trim() || 'Member'}
            </Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-3 px-2 pb-3">
          {messages.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Loading…
            </Text>
          ) : grouped.length === 0 ? (
            <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                No messages yet. Say hi.
              </Text>
            </View>
          ) : (
            grouped.map((group) => (
              <View key={group.key} className="gap-2">
                <FieldLabel className="text-center">
                  {group.label}
                </FieldLabel>
                {group.rows.map((m) => {
                  const fromMe = m.sender_id === session?.user.id;
                  return (
                    <View
                      key={m.id}
                      className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                        fromMe
                          ? 'self-end bg-primary'
                          : 'self-start bg-surface dark:bg-surface-dk border border-line dark:border-line-dk'
                      }`}>
                      <Text
                        className={
                          fromMe
                            ? 'text-on-primary text-sm'
                            : 'text-ink dark:text-ink-dk text-sm'
                        }>
                        {m.body}
                      </Text>
                      <Text
                        className={
                          fromMe
                            ? 'text-white/70 text-[10px] mt-1 text-right'
                            : 'text-ink-3 dark:text-ink-3-dk text-[10px] mt-1'
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

        <View className="flex-row items-end gap-2 px-2 pt-2 border-t border-line dark:border-line-dk">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            placeholderTextColor={colors.ink3}
            multiline
            className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-2xl px-4 py-3 text-ink dark:text-ink-dk text-base"
            style={{ minHeight: 44, maxHeight: 120 }}
          />
          <Pressable
            onPress={() => send.mutate()}
            disabled={!draft.trim() || send.isPending}
            className={`w-11 h-11 rounded-full items-center justify-center ${
              !draft.trim() || send.isPending
                ? 'bg-sunken dark:bg-sunken-dk'
                : 'bg-primary active:bg-primary-dark'
            }`}>
            <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
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
