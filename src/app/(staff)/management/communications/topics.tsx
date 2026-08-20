import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type Topic = {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
};

export default function EmailTopicsScreen() {
  const { data: membership } = useGymMembership();
  const canManageComms = useCan('can_manage_comms');
  const queryClient = useQueryClient();
  const colors = useThemeColors();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const topics = useQuery({
    queryKey: ['gym-email-topics', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<Topic[]> => {
      const { data, error: e } = await supabase
        .from('gym_email_topics')
        .select('id, label, description, sort_order')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('sort_order')
        .order('created_at');
      if (e) throw e;
      return (data ?? []) as Topic[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      if (label.trim() === '') throw new Error('Label is required');
      const { error: e } = await supabase.from('gym_email_topics').insert({
        gym_id: membership.gymId,
        label: label.trim(),
        description: description.trim() || null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setLabel('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['gym-email-topics'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add topic')),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase
        .from('gym_email_topics')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id);
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-email-topics'] });
    },
  });

  if (canManageComms === false) return <Redirect href="/management" />;
  if (!membership) return null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/communications" />
        <PageHead
          title="Email topics"
          subtitle="Categorise your sends so members can choose what they hear from you. A member who unsubscribes from “Promos” still receives “Billing reminders”."
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Add a topic
          </Text>
          <Input
            label="Label"
            value={label}
            onChangeText={setLabel}
            placeholder="Newsletter"
            autoCapitalize="words"
          />
          <Input
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="What members see in the preferences screen."
          />
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}
          <Button
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={label.trim() === ''}>
            Add topic
          </Button>
        </View>

        <View className="gap-2">
          <SectionLabel>
            Live topics
          </SectionLabel>
          {topics.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Loading…
            </Text>
          ) : (topics.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="layers-outline"
              title="No topics yet"
              description="New campaigns will send without a topic — blanket unsubscribes are the only suppression."
            />
          ) : (
            <View className="gap-2">
              {topics.data!.map((t) => (
                <View
                  key={t.id}
                  className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1">
                  <View className="flex-row items-start gap-3">
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
                    <Pressable
                      onPress={() => archive.mutate(t.id)}
                      hitSlop={8}
                      accessibilityLabel="Archive topic"
                      className="active:opacity-70 px-2 py-1">
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={colors.ink3}
                      />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
