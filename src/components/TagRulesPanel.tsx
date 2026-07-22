import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TagRuleEditor, type TagRule } from '@/components/TagRuleEditor';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// The tag-rules editor body — the rules list, the "recompute now" action
// and the create/edit form. Shared by the standalone /management/tags
// route and the Members-tab "Tag rules" modal so both stay in sync.
export function TagRulesPanel() {
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
    <View className="gap-4">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        Rules auto-tag members when their cohort state matches. Recompute
        after editing — there's no scheduled job yet.
      </Text>

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
              className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 border border-gray-100 dark:border-gray-800 shadow-card">
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
    </View>
  );
}
