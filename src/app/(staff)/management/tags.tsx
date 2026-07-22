import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { Input } from '@/components/Input';
import { MemberTagChip } from '@/components/MemberTagChip';
import { Screen } from '@/components/Screen';
import { TagRulesPanel } from '@/components/TagRulesPanel';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type TagRow = {
  id: string;
  label: string;
  color: string;
  source: 'manual' | 'auto';
  rule_id: string | null;
};

export default function TagsScreen() {
  const canManageTags = useCan('can_manage_tags');
  const { profile } = useLocalSearchParams<{ profile?: string }>();
  if (canManageTags === false) {
    return <Redirect href="/management" />;
  }
  return profile ? <MemberTags profileId={profile} /> : <RulesEditor />;
}

function MemberTags({ profileId }: { profileId: string }) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>(PALETTE[0]!.hex);
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['member-profile', profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', profileId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const tagsQuery = useQuery({
    queryKey: ['member-tags-for', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_tags')
        .select('id, label, color, source, rule_id')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['member-tags-for', membership?.gymId, profileId] });
    queryClient.invalidateQueries({ queryKey: ['member-tags', membership?.gymId] });
  };

  const addTag = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      const trimmed = label.trim();
      if (trimmed.length === 0) throw new Error('Label is required');
      const { error } = await supabase.from('member_tags').insert({
        gym_id: membership.gymId,
        profile_id: profileId,
        label: trimmed,
        color,
        source: 'manual',
        created_by: session.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLabel('');
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not add tag')),
  });

  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase.from('member_tags').delete().eq('id', tagId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setError(errorMessage(e, 'Could not remove tag')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            {profileQuery.data?.full_name ?? 'Member'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Manual tags only. Auto tags are managed by rules and recomputed
            against the live cohort view.
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Current tags
          </Text>
          {tagsQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
          ) : (tagsQuery.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No tags yet.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {(tagsQuery.data ?? []).map((t) => (
                <MemberTagChip
                  key={t.id}
                  label={t.label}
                  color={t.color}
                  source={t.source}
                  onRemove={t.source === 'manual' ? () => removeTag.mutate(t.id) : undefined}
                />
              ))}
            </View>
          )}
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4 shadow-card">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Add manual tag
          </Text>
          <Input
            label="Label"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. VIP"
          />
          <View className="gap-2">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Colour
            </Text>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button onPress={() => addTag.mutate()} loading={addTag.isPending}>
            Add tag
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}

function RulesEditor() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Tag rules
          </Text>
        </View>
        <TagRulesPanel />
      </ScrollView>
    </Screen>
  );
}
