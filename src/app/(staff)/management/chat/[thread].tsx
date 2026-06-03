import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  message_id: string;
  sender_profile_id: string;
  body: string;
  created_at: string;
};

type ThreadHeader = {
  thread_id: string;
  profile_id: string;
  profiles: { full_name: string | null } | null;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StaffChatThread() {
  const params = useLocalSearchParams<{ thread: string }>();
  const threadId = params.thread;
  const session = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const headerQuery = useQuery({
    queryKey: ['staff-chat-header', threadId],
    enabled: !!threadId,
    queryFn: async (): Promise<ThreadHeader | null> => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select(
          'thread_id, profile_id, profiles!chat_threads_profile_id_fkey(full_name)',
        )
        .eq('thread_id', threadId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ThreadHeader | null) ?? null;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', threadId],
    enabled: !!threadId,
    refetchInterval: 8000,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('message_id, sender_profile_id, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ChatMessage[];
    },
  });

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

  useEffect(() => {
    if (threadId) {
      supabase
        .from('chat_threads')
        .update({ last_staff_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .then(() => {});
    }
  }, [threadId, messagesQuery.data?.length]);

  const memberName = Array.isArray(headerQuery.data?.profiles)
    ? headerQuery.data?.profiles[0]?.full_name ?? 'Member'
    : headerQuery.data?.profiles?.full_name ?? 'Member';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <View className="flex-1 md:max-w-2xl md:mx-auto md:w-full">
          <View className="px-4 pt-6">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {memberName}
            </Text>
          </View>
          <ScrollView
            ref={scrollRef}
            contentContainerClassName="gap-2 p-4"
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }>
            {messagesQuery.data?.map((m) => {
              const isStaff = m.sender_profile_id === session?.user.id;
              return (
                <View
                  key={m.message_id}
                  className={`max-w-[80%] rounded-xl px-3 py-2 ${
                    isStaff
                      ? 'self-end bg-primary'
                      : 'self-start bg-white dark:bg-gray-900'
                  }`}>
                  <Text
                    className={
                      isStaff ? 'text-white' : 'text-gray-900 dark:text-gray-50'
                    }>
                    {m.body}
                  </Text>
                  <Text
                    className={`text-[10px] mt-0.5 ${
                      isStaff
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
                placeholder="Reply…"
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
