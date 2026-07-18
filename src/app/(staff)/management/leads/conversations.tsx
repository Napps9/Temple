import { useQuery } from '@tanstack/react-query';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type ConversationRow = {
  id: string;
  phone: string;
  channel: 'sms' | 'voice';
  status: 'active' | 'handed_off' | 'closed';
  last_message_at: string;
  lead: { full_name: string } | null;
};

const STATUS_COPY: Record<ConversationRow['status'], { label: string; cls: string }> = {
  active: { label: 'AI replying', cls: 'text-emerald-600 dark:text-emerald-400' },
  handed_off: { label: 'With a coach', cls: 'text-amber-600 dark:text-amber-400' },
  closed: { label: 'Opted out', cls: 'text-gray-400 dark:text-gray-500' },
};

export default function AgentConversationsScreen() {
  const { data: membership } = useGymMembership();
  const canAssignPlan = useCan('can_assign_plan');

  const conversations = useQuery({
    queryKey: ['agent-conversations', membership?.gymId],
    enabled: !!membership?.gymId && canAssignPlan === true,
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from('agent_conversations')
        .select('id, phone, channel, status, last_message_at, lead:leads!lead_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ConversationRow[];
    },
  });

  if (canAssignPlan === false) return <Redirect href="/management" />;
  if (!membership) return null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Leads" fallbackHref="/management/leads" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            AI conversations
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Every text and call the front desk assistant has handled. Open one
            to read it or take over.
          </Text>
        </View>

        <View className="gap-2">
          {(conversations.data ?? []).map((c) => (
            <Link key={c.id} href={`/management/leads/conversation/${c.id}`} asChild>
              <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 shadow-card active:opacity-80">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-gray-900 dark:text-gray-50 font-medium flex-1">
                    {c.lead?.full_name ?? c.phone}
                  </Text>
                  <Text className={`text-xs font-medium ${STATUS_COPY[c.status].cls}`}>
                    {STATUS_COPY[c.status].label}
                  </Text>
                </View>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {c.channel === 'voice' ? 'Phone call' : 'SMS'}
                    {c.lead ? ` · ${c.phone}` : ''}
                  </Text>
                  <Text className="text-gray-400 dark:text-gray-500 text-xs">
                    {new Date(c.last_message_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </Pressable>
            </Link>
          ))}
          {conversations.isSuccess && (conversations.data ?? []).length === 0 ? (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-6 items-center shadow-card">
              <Text className="text-gray-500 dark:text-gray-400 text-center">
                No conversations yet. When someone texts or calls your gym's
                number, the thread appears here.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
