import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { Input } from '@/components/Input';
import { MemberTagChip } from '@/components/MemberTagChip';
import { Screen } from '@/components/Screen';
import { TagRuleEditor, type TagRule } from '@/components/TagRuleEditor';
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
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
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

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
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
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TagRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ['tag-rules', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tag_rules')
        .select('id, gym_id, label, color, predicate_kind, threshold_days, active')
        .eq('gym_id', membership!.gymId)
        .order('label');
      if (error) throw error;
      return (data ?? []) as TagRule[];
    },
  });

  const recompute = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase.rpc('apply_tag_rules', {
        p_gym_id: membership.gymId,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      setRecomputeMsg(`Applied: ${count} auto tag${count === 1 ? '' : 's'} now in place.`);
      queryClient.invalidateQueries({ queryKey: ['member-tags', membership?.gymId] });
    },
    onError: (e) => setRecomputeMsg(errorMessage(e, 'Could not recompute tags')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Tag rules
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Rules auto-tag members when their cohort state matches. Recompute
            after editing — there's no scheduled job yet.
          </Text>
        </View>

        <Button onPress={() => recompute.mutate()} loading={recompute.isPending}>
          Recompute now
        </Button>
        {recomputeMsg ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">{recomputeMsg}</Text>
        ) : null}

        {rulesQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : (rulesQuery.data ?? []).length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            No rules yet. Add one below.
          </Text>
        ) : (
          <View className="gap-2">
            {(rulesQuery.data ?? []).map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  setEditing(r);
                  setCreating(false);
                }}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3">
                <View
                  style={{ backgroundColor: r.color }}
                  className="w-3 h-3 rounded-full"
                />
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-gray-50 font-medium">
                    {r.label}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {r.predicate_kind}
                    {r.threshold_days !== null ? ` · ${r.threshold_days} days` : ''}
                    {r.active ? '' : ' · paused'}
                  </Text>
                </View>
                <Text className="text-primary">›</Text>
              </Pressable>
            ))}
          </View>
        )}

        {editing ? (
          <TagRuleEditor
            rule={editing}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        ) : creating ? (
          <TagRuleEditor
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button variant="secondary" onPress={() => setCreating(true)}>
            Add a rule
          </Button>
        )}
      </ScrollView>
    </Screen>
  );
}
