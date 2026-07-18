import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type Conversation = {
  id: string;
  phone: string;
  channel: 'sms' | 'voice';
  status: 'active' | 'handed_off' | 'closed';
  lead: { id: string; full_name: string } | null;
};

type MessageRow = {
  id: string;
  role: 'lead' | 'agent' | 'staff' | 'system';
  body: string;
  created_at: string;
};

export default function AgentConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: membership } = useGymMembership();
  const canAssignPlan = useCan('can_assign_plan');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const conversation = useQuery({
    queryKey: ['agent-conversation', id],
    enabled: !!id && canAssignPlan === true,
    queryFn: async (): Promise<Conversation | null> => {
      const { data, error: e } = await supabase
        .from('agent_conversations')
        .select('id, phone, channel, status, lead:leads!lead_id(id, full_name)')
        .eq('id', id!)
        .maybeSingle();
      if (e) throw e;
      return (data as unknown as Conversation) ?? null;
    },
  });

  const messages = useQuery({
    queryKey: ['agent-messages', id],
    enabled: !!id && canAssignPlan === true,
    // Polling keeps the thread live while staff watch the agent work —
    // cheap RLS reads, no realtime plumbing.
    refetchInterval: 5000,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error: e } = await supabase
        .from('agent_messages')
        .select('id, role, body, created_at')
        .eq('conversation_id', id!)
        .order('created_at', { ascending: true })
        .limit(200);
      if (e) throw e;
      return (data ?? []) as MessageRow[];
    },
  });

  const act = useMutation({
    mutationFn: async (payload: {
      action: 'take_over' | 'send' | 'reopen';
      body?: string;
    }) => {
      const { data, error: e } = await supabase.functions.invoke(
        'lead-agent-staff-send',
        { body: { conversation_id: id, ...payload } },
      );
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: (_data, payload) => {
      setError(null);
      if (payload.action === 'send') setDraft('');
      queryClient.invalidateQueries({ queryKey: ['agent-conversation', id] });
      queryClient.invalidateQueries({ queryKey: ['agent-messages', id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not update the conversation')),
  });

  if (canAssignPlan === false) return <Redirect href="/management" />;
  if (!membership) return null;

  const c = conversation.data;
  const status = c?.status;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Conversations" fallbackHref="/management/leads/conversations" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            {c?.lead?.full_name ?? c?.phone ?? 'Conversation'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {c
              ? `${c.channel === 'voice' ? 'Phone call' : 'SMS'} · ${c.phone} · ${
                  status === 'active'
                    ? 'AI replying'
                    : status === 'handed_off'
                      ? 'With a coach'
                      : 'Opted out'
                }`
              : ''}
          </Text>
        </View>

        {c && status !== 'closed' ? (
          <View className="flex-row gap-2">
            {status === 'active' ? (
              <ChipButton
                label="Take over"
                icon="hand-left-outline"
                tone="amber"
                onPress={() => act.mutate({ action: 'take_over' })}
              />
            ) : (
              <ChipButton
                label="Hand back to AI"
                icon="sparkles-outline"
                tone="primary"
                onPress={() => act.mutate({ action: 'reopen' })}
              />
            )}
          </View>
        ) : null}

        <View className="gap-2">
          {(messages.data ?? []).map((m) => {
            if (m.role === 'system') {
              return (
                <View key={m.id} className="px-4 py-2">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs italic">
                    {m.body}
                  </Text>
                </View>
              );
            }
            const fromLead = m.role === 'lead';
            return (
              <View
                key={m.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  fromLead
                    ? 'self-start bg-gray-200 dark:bg-gray-800'
                    : 'self-end bg-primary/10'
                }`}>
                <Text className="text-gray-900 dark:text-gray-50">{m.body}</Text>
                <Text className="text-gray-400 dark:text-gray-500 text-[10px] mt-1">
                  {m.role === 'agent' ? 'AI · ' : m.role === 'staff' ? 'Staff · ' : ''}
                  {new Date(m.created_at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            );
          })}
          {messages.isSuccess && (messages.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-center py-6">
              No messages yet.
            </Text>
          ) : null}
        </View>

        {c && status !== 'closed' ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Input
              label="Reply as staff"
              value={draft}
              onChangeText={setDraft}
              multiline
              placeholder="Texts the lead from your gym's number and pauses the AI"
            />
            <Button
              onPress={() => act.mutate({ action: 'send', body: draft })}
              loading={act.isPending}
              disabled={!draft.trim()}>
              Send text
            </Button>
          </View>
        ) : null}
        {c && status === 'closed' ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            This person replied STOP, so the thread is closed and no more
            texts can be sent.
          </Text>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
