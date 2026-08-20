import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { TagRuleEditor } from '@/components/TagRuleEditor';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { describeTagRule, type TagRule } from '@/lib/tag-rules';

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
        .select('id, gym_id, label, color, predicate_kind, threshold_days, class_type_id, plan_id, member_visible, active')
        .eq('gym_id', membership!.gymId)
        .order('label');
      if (error) throw error;
      return (data ?? []) as TagRule[];
    },
  });

  // Name lookups for the rule subtitles; only fetched once a rule
  // actually references a class type or plan.
  const wantsClassTypes = (rulesQuery.data ?? []).some((r) => r.class_type_id);
  const wantsPlans = (rulesQuery.data ?? []).some((r) => r.plan_id);

  const classTypesQuery = useQuery({
    queryKey: ['class-type-names', membership?.gymId],
    enabled: !!membership?.gymId && wantsClassTypes,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const plansQuery = useQuery({
    queryKey: ['membership-plan-names', membership?.gymId],
    enabled: !!membership?.gymId && wantsPlans,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('plan_id, name')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as { plan_id: string; name: string }[];
    },
  });

  const classTypeNames = useMemo(
    () => new Map((classTypesQuery.data ?? []).map((ct) => [ct.id, ct.name])),
    [classTypesQuery.data],
  );
  const planNames = useMemo(
    () => new Map((plansQuery.data ?? []).map((p) => [p.plan_id, p.name])),
    [plansQuery.data],
  );

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
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Rules auto-tag members from their classes, bookings and membership.
        They recompute nightly; recompute now to apply an edit immediately.
      </Text>

      <Button onPress={() => recompute.mutate()} loading={recompute.isPending}>
        Recompute now
      </Button>
      {recomputeMsg ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">{recomputeMsg}</Text>
      ) : null}

      {rulesQuery.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
      ) : (rulesQuery.data ?? []).length === 0 ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
              className="bg-surface dark:bg-surface-dk rounded-card p-4 flex-row items-center gap-3 border border-line dark:border-line-dk">
              <View
                style={{ backgroundColor: r.color }}
                className="w-3 h-3 rounded-full"
              />
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  {r.label}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {describeTagRule(r, {
                    classTypeName: r.class_type_id
                      ? classTypeNames.get(r.class_type_id)
                      : undefined,
                    planName: r.plan_id ? planNames.get(r.plan_id) : undefined,
                  })}
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
