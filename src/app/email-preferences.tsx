import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { EmptyState } from '@/components/EmptyState';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Preference = {
  topic_id: string;
  label: string;
  description: string | null;
  subscribed: boolean;
  blanket_unsub: boolean;
};

export default function EmailPreferencesScreen() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: ['my-email-preferences', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Preference[]> => {
      const { data, error } = await supabase.rpc('list_my_email_preferences', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as Preference[];
    },
  });

  const setTopic = useMutation({
    mutationFn: async ({ topicId, subscribed }: { topicId: string; subscribed: boolean }) => {
      const { error } = await supabase.rpc('set_my_email_topic_subscription', {
        p_gym_id: membership!.gymId,
        p_topic_id: topicId,
        p_subscribed: subscribed,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-email-preferences'] });
    },
  });

  const setBlanket = useMutation({
    mutationFn: async (unsubscribed: boolean) => {
      const { error } = await supabase.rpc('set_my_email_blanket_unsub', {
        p_gym_id: membership!.gymId,
        p_unsubscribed: unsubscribed,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-email-preferences'] });
    },
  });

  if (!membership) return null;

  const blanketUnsub = prefs.data?.[0]?.blanket_unsub ?? false;
  const topics = prefs.data ?? [];
  const gymName = membership.gymName ?? 'this gym';

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/account" />
        <PageHead
          title="Email preferences"
          subtitle={`Choose which emails from ${gymName} land in your inbox. Changes save instantly and apply from the next send.`}
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                {`Receive any emails from ${gymName}`}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Turn this off to stop everything — including class-change and
                booking notices. Per-topic choices below come back the next
                time you turn it on.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Receive any emails from this gym"
              value={!blanketUnsub}
              onValueChange={(v) => setBlanket.mutate(!v)}
              disabled={setBlanket.isPending}
            />
          </View>
        </View>

        {prefs.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Loading…
          </Text>
        ) : topics.length === 0 ? (
          <EmptyState
            icon="mail-outline"
            title="No email topics yet"
            description="Until this gym sets some up, your only switch is the master one above."
          />
        ) : (
          <View className="gap-2">
            <SectionLabel>{`Topics from ${gymName}`}</SectionLabel>
            {topics.map((t) => (
              <Pressable
                key={t.topic_id}
                onPress={() =>
                  !blanketUnsub &&
                  setTopic.mutate({
                    topicId: t.topic_id,
                    subscribed: !t.subscribed,
                  })
                }
                className={`bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 ${
                  blanketUnsub ? 'opacity-50' : ''
                }`}>
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="text-ink dark:text-ink-dk font-medium">
                      {t.label}
                    </Text>
                    {t.description ? (
                      <Text className="text-ink-2 dark:text-ink-2-dk text-xs mt-0.5">
                        {t.description}
                      </Text>
                    ) : null}
                  </View>
                  <Switch
                    accessibilityLabel={t.label}
                    value={t.subscribed && !blanketUnsub}
                    onValueChange={(v) =>
                      setTopic.mutate({
                        topicId: t.topic_id,
                        subscribed: v,
                      })
                    }
                    disabled={setTopic.isPending || blanketUnsub}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {setTopic.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(setTopic.error, 'Could not save preference')}
          </Text>
        ) : null}
        {setBlanket.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(setBlanket.error, 'Could not save master toggle')}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
