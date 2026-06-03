import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  message_id: string;
  sender_profile_id: string;
  body: string;
  created_at: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MemberChat() {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Get-or-create the member's thread at this gym.
  const threadQuery = useQuery({
    queryKey: ['chat-thread', gym?.gymId, session?.user.id],
    enabled: !!gym?.gymId && !!session?.user.id,
    queryFn: async (): Promise<string> => {
      const { data: existing } = await supabase
        .from('chat_threads')
        .select('thread_id')
        .eq('gym_id', gym!.gymId)
        .eq('profile_id', session!.user.id)
        .maybeSingle();
      if (existing?.thread_id) return existing.thread_id;
      const { data: created, error: createErr } = await supabase
        .from('chat_threads')
        .insert({ gym_id: gym!.gymId, profile_id: session!.user.id })
        .select('thread_id')
        .single();
      if (createErr) throw createErr;
      return created.thread_id;
    },
  });

  const threadId = threadQuery.data ?? null;

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', threadId],
    enabled: !!threadId,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('message_id, sender_profile_id, body, created_at')
        .eq('thread_id', threadId!)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ChatMessage[];
    },
  });

  // Realtime subscription to new messages in this thread.
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`chat-thread-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['chat-messages', threadId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, queryClient]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body || !threadId || !session) return;
      const { error } = await supabase.from('chat_messages').insert({
        thread_id: threadId,
        sender_profile_id: session.user.id,
        body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['chat-messages', threadId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  // Touch last_member_read_at when the messages view becomes visible.
  useEffect(() => {
    if (threadId) {
      supabase
        .from('chat_threads')
        .update({ last_member_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .then(() => {});
    }
  }, [threadId, messagesQuery.data?.length]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <View className="flex-1 md:max-w-2xl md:mx-auto md:w-full">
          <View className="px-4 pt-6 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Chat
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Message your coaches.
            </Text>
          </View>
          <ScrollView
            ref={scrollRef}
            contentContainerClassName="gap-2 p-4"
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }>
            {messagesQuery.data?.length === 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
                <Text className="text-gray-500 dark:text-gray-400">
                  No messages yet — say hello.
                </Text>
              </View>
            ) : null}
            {messagesQuery.data?.map((m) => {
              const isSelf = m.sender_profile_id === session?.user.id;
              return (
                <View
                  key={m.message_id}
                  className={`max-w-[80%] rounded-xl px-3 py-2 ${
                    isSelf
                      ? 'self-end bg-primary'
                      : 'self-start bg-white dark:bg-gray-900'
                  }`}>
                  <Text
                    className={
                      isSelf ? 'text-white' : 'text-gray-900 dark:text-gray-50'
                    }>
                    {m.body}
                  </Text>
                  <Text
                    className={`text-[10px] mt-0.5 ${
                      isSelf
                        ? 'text-white/70'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}>
                    {fmtTime(m.created_at)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
          <View className="border-t border-gray-200 dark:border-gray-800 p-3 gap-2">
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
            ) : null}
            <View className="flex-row items-end gap-2">
              <TextInput
                className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50"
                placeholder="Message…"
                placeholderTextColor="#9CA3AF"
                value={draft}
                onChangeText={setDraft}
                multiline
                style={{ minHeight: 40, maxHeight: 120 }}
              />
              <Pressable
                onPress={() => sendMutation.mutate()}
                disabled={!draft.trim() || sendMutation.isPending}
                className={`rounded-lg px-4 py-2 ${
                  !draft.trim() || sendMutation.isPending
                    ? 'bg-gray-300 dark:bg-gray-700'
                    : 'bg-primary'
                }`}>
                <Text className="text-white font-semibold">Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
