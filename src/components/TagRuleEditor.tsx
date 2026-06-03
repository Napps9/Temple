import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ColorSwatchPicker, PALETTE } from '@/components/ColorSwatchPicker';
import { Input } from '@/components/Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type TagRule = {
  id: string;
  gym_id: string;
  label: string;
  color: string;
  predicate_kind: PredicateKind;
  threshold_days: number | null;
  active: boolean;
};

type PredicateKind =
  | 'intro'
  | 'expiring_soon'
  | 'expired'
  | 'paying'
  | 'inactive'
  | 'never_paid';

const KIND_OPTIONS: { value: PredicateKind; label: string; usesThreshold: boolean }[] = [
  { value: 'intro',         label: 'Intro',         usesThreshold: false },
  { value: 'expiring_soon', label: 'Expiring soon', usesThreshold: true },
  { value: 'expired',       label: 'Expired',       usesThreshold: false },
  { value: 'paying',        label: 'Paying',        usesThreshold: false },
  { value: 'inactive',      label: 'Inactive',      usesThreshold: false },
  { value: 'never_paid',    label: 'Never paid',    usesThreshold: false },
];

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
  const [kind, setKind] = useState<PredicateKind>(rule?.predicate_kind ?? 'expiring_soon');
  const [thresholdDays, setThresholdDays] = useState(
    rule?.threshold_days?.toString() ?? '7',
  );
  const [active, setActive] = useState(rule?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const usesThreshold = KIND_OPTIONS.find((o) => o.value === kind)?.usesThreshold ?? false;

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      if (label.trim().length === 0) throw new Error('Label is required');
      let threshold: number | null = null;
      if (usesThreshold) {
        const n = Number.parseInt(thresholdDays, 10);
        if (!Number.isFinite(n) || n < 0) throw new Error('Threshold must be a non-negative integer');
        threshold = n;
      }
      const payload = {
        gym_id: membership.gymId,
        label: label.trim(),
        color,
        predicate_kind: kind,
        threshold_days: threshold,
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
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {rule ? 'Edit rule' : 'New rule'}
      </Text>

      <Input label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Renew soon" />

      <View className="gap-2">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Colour
        </Text>
        <ColorSwatchPicker value={color} onChange={setColor} />
      </View>

      <View className="gap-2">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          When the member is
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {KIND_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => setKind(o.value)}
              className={`px-3 py-1.5 rounded-full border ${
                kind === o.value
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={
                  kind === o.value
                    ? 'text-primary text-sm'
                    : 'text-gray-500 dark:text-gray-400 text-sm'
                }>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {usesThreshold ? (
        <Input
          label="Threshold (days)"
          value={thresholdDays}
          onChangeText={setThresholdDays}
          placeholder="7"
          keyboardType="number-pad"
        />
      ) : null}

      <Pressable
        onPress={() => setActive(!active)}
        className="flex-row items-center gap-2">
        <View
          className={`w-5 h-5 rounded border ${
            active
              ? 'bg-primary border-primary'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'
          }`}>
          {active ? (
            <Text className="text-white text-center text-xs leading-5">✓</Text>
          ) : null}
        </View>
        <Text className="text-gray-900 dark:text-gray-50">Active</Text>
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
