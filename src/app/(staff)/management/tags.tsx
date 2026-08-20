import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

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
  member_visible: boolean;
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
  const [memberVisible, setMemberVisible] = useState(false);
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
        .select('id, label, color, source, rule_id, member_visible')
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
        member_visible: memberVisible,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLabel('');
      setMemberVisible(false);
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not add tag')),
  });

  const toggleVisible = useMutation({
    mutationFn: async (tag: TagRow) => {
      const { error } = await supabase
        .from('member_tags')
        .update({ member_visible: !tag.member_visible })
        .eq('id', tag.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setError(errorMessage(e, 'Could not change visibility')),
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
        <BackLink fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            {profileQuery.data?.full_name ?? 'Member'}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Manual tags only. Auto tags are managed by rules and recomputed
            against the live cohort view.
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
            Current tags
          </Text>
          {tagsQuery.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
          ) : (tagsQuery.data ?? []).length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
                  visible={t.member_visible}
                  onToggleVisible={
                    t.source === 'manual' ? () => toggleVisible.mutate(t) : undefined
                  }
                  onRemove={t.source === 'manual' ? () => removeTag.mutate(t.id) : undefined}
                />
              ))}
            </View>
          )}
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            The eye marks tags the member can see themselves; everything else
            stays internal. Tap it to flip a manual tag; auto tags follow
            their rule's setting.
          </Text>
        </View>

        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-4 shadow-card">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Add manual tag
          </Text>
          <Input
            label="Label"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. VIP"
          />
          <View className="gap-2">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              Colour
            </Text>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </View>
          <Pressable
            onPress={() => setMemberVisible(!memberVisible)}
            className="flex-row items-center gap-2">
            <View
              className={`w-5 h-5 rounded border ${
                memberVisible
                  ? 'bg-primary border-primary'
                  : 'border-line-strong dark:border-line-strong-dk bg-surface dark:bg-surface-dk'
              }`}>
              {memberVisible ? (
                <Text className="text-white text-center text-xs leading-5">✓</Text>
              ) : null}
            </View>
            <Text className="text-ink dark:text-ink-dk">Visible to the member</Text>
          </Pressable>
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
        <BackLink fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            Tag rules
          </Text>
        </View>
        <TagRulesPanel />
      </ScrollView>
    </Screen>
  );
}
