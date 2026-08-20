import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { DurationField } from '@/components/DurationField';
import { Input } from '@/components/Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import {
  TAG_RULE_KINDS,
  tagRuleKindMeta,
  type TagRule,
  type TagRulePredicateKind,
} from '@/lib/tag-rules';

type Props = {
  rule?: TagRule;
  onDone: () => void;
  onCancel?: () => void;
};

export function TagRuleEditor({ rule, onDone, onCancel }: Props) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState(rule?.label ?? '');
  const [color, setColor] = useState(rule?.color ?? PALETTE[0]!.hex);
  const [kind, setKind] = useState<TagRulePredicateKind>(
    rule?.predicate_kind ?? 'expiring_soon',
  );
  const [thresholdDays, setThresholdDays] = useState(
    rule?.threshold_days?.toString() ?? tagRuleKindMeta(rule?.predicate_kind ?? 'expiring_soon').thresholdDefault ?? '',
  );
  const [classTypeId, setClassTypeId] = useState<string | null>(rule?.class_type_id ?? null);
  const [planId, setPlanId] = useState<string | null>(rule?.plan_id ?? null);
  const [memberVisible, setMemberVisible] = useState(rule?.member_visible ?? false);
  const [active, setActive] = useState(rule?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const meta = tagRuleKindMeta(kind);

  // Switching kind reseeds the window to that kind's default so a
  // look-back typed for one predicate doesn't silently apply to another.
  const changeKind = (next: TagRulePredicateKind) => {
    setKind(next);
    setThresholdDays(tagRuleKindMeta(next).thresholdDefault ?? '');
  };

  const classTypesQuery = useQuery({
    queryKey: ['class-types-active', membership?.gymId],
    enabled: !!membership?.gymId && !!meta.needsClassType,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; color: string }[];
    },
  });

  const plansQuery = useQuery({
    queryKey: ['membership-plans-active', membership?.gymId],
    enabled: !!membership?.gymId && !!meta.needsPlan,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('plan_id, name')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { plan_id: string; name: string }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      if (label.trim().length === 0) throw new Error('Label is required');
      if (meta.needsClassType && !classTypeId) throw new Error('Pick a class type');
      if (meta.needsPlan && !planId) throw new Error('Pick a plan');
      let threshold: number | null = null;
      if (meta.thresholdUse !== 'none' && thresholdDays.trim() !== '') {
        const n = Number.parseInt(thresholdDays, 10);
        if (!Number.isFinite(n) || n < 0) throw new Error('Window must be a non-negative number of days');
        threshold = n;
      }
      if (meta.thresholdUse === 'required' && threshold === null) {
        throw new Error(`${meta.thresholdLabel ?? 'Window'} is required`);
      }
      const payload = {
        gym_id: membership.gymId,
        label: label.trim(),
        color,
        predicate_kind: kind,
        threshold_days: meta.thresholdUse === 'none' ? null : threshold,
        class_type_id: meta.needsClassType ? classTypeId : null,
        plan_id: meta.needsPlan ? planId : null,
        member_visible: memberVisible,
        active,
        created_by: session.user.id,
      };
      if (rule) {
        const { error } = await supabase
          .from('tag_rules')
          .update(payload)
          .eq('id', rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('tag_rules').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['tag-rules'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save rule')),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!rule) return;
      const { error } = await supabase.from('tag_rules').delete().eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-rules'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e, 'Could not delete rule')),
  });

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-4 shadow-card">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        {rule ? 'Edit rule' : 'New rule'}
      </Text>

      <Input label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Renew soon" />

      <View className="gap-2">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Colour
        </Text>
        <ColorSwatchPicker value={color} onChange={setColor} />
      </View>

      <View className="gap-2">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          When the member is
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {TAG_RULE_KINDS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => changeKind(o.value)}
              className={`px-3 py-1.5 rounded-full border ${
                kind === o.value
                  ? 'border-primary bg-primary/10'
                  : 'border-line dark:border-line-dk'
              }`}>
              <Text
                className={
                  kind === o.value
                    ? 'text-primary text-sm'
                    : 'text-ink-2 dark:text-ink-2-dk text-sm'
                }>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {meta.needsClassType ? (
        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
            Class type
          </Text>
          {classTypesQuery.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
          ) : (classTypesQuery.data ?? []).length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No class types yet — create one under Classes first.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {(classTypesQuery.data ?? []).map((ct) => (
                <Pressable
                  key={ct.id}
                  onPress={() => setClassTypeId(ct.id)}
                  className={`px-3 py-1.5 rounded-full border flex-row items-center gap-1.5 ${
                    classTypeId === ct.id
                      ? 'border-primary bg-primary/10'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <View
                    style={{ backgroundColor: ct.color }}
                    className="w-2 h-2 rounded-full"
                  />
                  <Text
                    className={
                      classTypeId === ct.id
                        ? 'text-primary text-sm'
                        : 'text-ink-2 dark:text-ink-2-dk text-sm'
                    }>
                    {ct.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {meta.needsPlan ? (
        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
            Plan
          </Text>
          {plansQuery.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
          ) : (plansQuery.data ?? []).length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No plans yet — create one under Plans first.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {(plansQuery.data ?? []).map((p) => (
                <Pressable
                  key={p.plan_id}
                  onPress={() => setPlanId(p.plan_id)}
                  className={`px-3 py-1.5 rounded-full border ${
                    planId === p.plan_id
                      ? 'border-primary bg-primary/10'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <Text
                    className={
                      planId === p.plan_id
                        ? 'text-primary text-sm'
                        : 'text-ink-2 dark:text-ink-2-dk text-sm'
                    }>
                    {p.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {meta.thresholdUse !== 'none' ? (
        <DurationField
          label={meta.thresholdLabel ?? 'Window'}
          blurb={meta.thresholdUse === 'optional' ? 'Leave blank for any time.' : undefined}
          value={thresholdDays}
          onChange={setThresholdDays}
          base="days"
          units={['days', 'weeks', 'months']}
          placeholder={meta.thresholdUse === 'optional' ? 'Any time' : meta.thresholdDefault}
        />
      ) : null}

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
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk">Visible to the member</Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Off keeps this tag internal — members can never read tags that
            aren't marked visible.
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => setActive(!active)}
        className="flex-row items-center gap-2">
        <View
          className={`w-5 h-5 rounded border ${
            active
              ? 'bg-primary border-primary'
              : 'border-line-strong dark:border-line-strong-dk bg-surface dark:bg-surface-dk'
          }`}>
          {active ? (
            <Text className="text-white text-center text-xs leading-5">✓</Text>
          ) : null}
        </View>
        <Text className="text-ink dark:text-ink-dk">Active</Text>
      </Pressable>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <View className="flex-row gap-3">
        {onCancel ? (
          <View className="flex-1">
            <Button variant="secondary" onPress={onCancel}>
              Cancel
            </Button>
          </View>
        ) : null}
        <View className="flex-1">
          <Button onPress={() => save.mutate()} loading={save.isPending}>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </View>
      </View>
      {rule ? (
        <Button
          variant="ghost"
          onPress={() => remove.mutate()}
          loading={remove.isPending}>
          Delete rule
        </Button>
      ) : null}
    </View>
  );
}
