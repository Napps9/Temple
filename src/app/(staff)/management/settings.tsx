import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSavedFlag } from '@/lib/useSavedFlag';

type Metric = 'intros_new' | 'conversions' | 'retention';
type Period = 'month' | 'quarter';

type TargetRow = {
  metric: Metric;
  period: Period;
  target_value: number;
};

const METRICS: { value: Metric; label: string; description: string }[] = [
  {
    value: 'intros_new',
    label: 'New intros',
    description: 'Members starting an intro period (e.g. trial, foundations).',
  },
  {
    value: 'conversions',
    label: 'Conversions',
    description: 'Intros who became paying members in the period.',
  },
  {
    value: 'retention',
    label: 'Retention',
    description: 'Members who stay active across the period.',
  },
];

const PERIODS: Period[] = ['month', 'quarter'];

export default function SettingsScreen() {
  const role = useRole();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const targetsQuery = useQuery({
    queryKey: ['insight-targets', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_insight_targets')
        .select('metric, period, target_value')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  useEffect(() => {
    if (!targetsQuery.data) return;
    const next: Record<string, string> = {};
    for (const t of targetsQuery.data) {
      next[`${t.metric}-${t.period}`] = String(t.target_value);
    }
    setValues(next);
  }, [targetsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      const toUpsert: {
        gym_id: string;
        metric: Metric;
        period: Period;
        target_value: number;
        updated_by: string;
      }[] = [];
      for (const m of METRICS) {
        for (const p of PERIODS) {
          const key = `${m.value}-${p}`;
          const raw = values[key]?.trim() ?? '';
          if (raw.length === 0) continue;
          const n = Number.parseInt(raw, 10);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`${m.label} (${p}): must be a non-negative integer`);
          }
          toUpsert.push({
            gym_id: membership.gymId,
            metric: m.value,
            period: p,
            target_value: n,
            updated_by: session.user.id,
          });
        }
      }
      if (toUpsert.length === 0) return;
      const { error } = await supabase
        .from('gym_insight_targets')
        .upsert(toUpsert, { onConflict: 'gym_id,metric,period' });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['insight-targets'] });
      queryClient.invalidateQueries({ queryKey: ['insights-summary'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save targets')),
  });

  if (role && !can(role, 'can_set_targets')) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Insight targets
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Set monthly and quarterly goals. Insights tiles show progress
            against these.
          </Text>
        </View>

        <View className="gap-4">
          {METRICS.map((m) => (
            <View
              key={m.value}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
              <View className="gap-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {m.label}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {m.description}
                </Text>
              </View>
              <View className="flex-row gap-3">
                {PERIODS.map((p) => {
                  const key = `${m.value}-${p}`;
                  return (
                    <View key={p} className="flex-1">
                      <Input
                        label={p === 'month' ? 'Per month' : 'Per quarter'}
                        value={values[key] ?? ''}
                        onChangeText={(v) => setValues({ ...values, [key]: v })}
                        placeholder="0"
                        keyboardType="number-pad"
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button onPress={() => save.mutate()} loading={save.isPending} success={saved}>
          Save targets
        </Button>
      </ScrollView>
    </Screen>
  );
}
