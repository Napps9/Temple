import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { SectionLabel } from '@/components/SectionLabel';
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

// Topics, as a section of Email settings rather than a screen of its own.
// They are one decision — what a member can unsubscribe from separately —
// and that is what the Settings pattern is for.
export function TopicsCard() {
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

  if (canManageComms !== true) return null;

  return (
    <View className="gap-2">
      <SectionLabel>Topics</SectionLabel>

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk text-[15.5px] font-semibold tracking-[-0.2px]">
            Add a topic
          </Text>
          <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] leading-[17px]">
            Categorise your sends so members can choose what they hear from
            you. Someone who unsubscribes from “Promos” still gets “Billing
            reminders”.
          </Text>
        </View>
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
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <View className="flex-row justify-end">
          <Button
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={label.trim() === ''}>
            Add topic
          </Button>
        </View>
      </View>

      {topics.isLoading ? (
        <EmptyState kind="loading" rows={2} />
      ) : (topics.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="layers-outline"
          title="No topics yet"
          description="New campaigns send without one, so a blanket unsubscribe is the only suppression a member has."
        />
      ) : (
        topics.data!.map((t) => (
          <View
            key={t.id}
            className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 flex-row items-start gap-3">
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
              accessibilityLabel={`Archive ${t.label}`}
              className="active:opacity-70 px-2 py-1">
              <Ionicons name="trash-outline" size={16} color={colors.ink3} />
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}
