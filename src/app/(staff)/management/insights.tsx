import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BillingNotLiveTile } from '@/components/BillingNotLiveTile';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';

type Period = 'month' | 'quarter';

type Summary = {
  intros_new: number;
  intros_target: number;
  conversions: number;
  conversions_target: number;
  expiring_soon: number;
  expired: number;
  paying_now: number;
  billing_live: boolean;
};

type TargetMetric = 'intros_new' | 'conversions' | 'retention';

type TargetRow = {
  metric: TargetMetric;
  period: Period;
  target_value: number;
};

const TARGET_METRICS: { value: TargetMetric; label: string; description: string }[] = [
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

const TARGET_PERIODS: Period[] = ['month', 'quarter'];

function periodRange(period: Period, today: Date): { start: string; end: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (period === 'month') {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return { start: isoDate(start), end: isoDate(end) };
  }
  const quarter = Math.floor(m / 3);
  const start = new Date(Date.UTC(y, quarter * 3, 1));
  const end = new Date(Date.UTC(y, quarter * 3 + 3, 0));
  return { start: isoDate(start), end: isoDate(end) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function InsightsScreen() {
  const { data: membership } = useGymMembership();
  const canSeeInsights = useCan('can_see_insights');
  const canSetTargets = useCan('can_set_targets');
  const [period, setPeriod] = useState<Period>('month');

  const { start, end } = useMemo(() => periodRange(period, new Date()), [period]);

  const summary = useQuery({
    queryKey: ['insights-summary', membership?.gymId, period, start, end],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc('compute_insight_summary', {
        p_gym_id: membership!.gymId,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      const rows = data as unknown as Summary[];
      if (!rows || rows.length === 0) {
        return {
          intros_new: 0,
          intros_target: 0,
          conversions: 0,
          conversions_target: 0,
          expiring_soon: 0,
          expired: 0,
          paying_now: 0,
          billing_live: false,
        };
      }
      return rows[0];
    },
  });

  if (canSeeInsights === false) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Insights
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Lifecycle cohorts for your gym — intros, who's expiring soon,
            and conversion against your targets.
          </Text>
        </View>

        <View className="flex-row gap-2">
          <PeriodTab
            label="This month"
            active={period === 'month'}
            onPress={() => setPeriod('month')}
          />
          <PeriodTab
            label="This quarter"
            active={period === 'quarter'}
            onPress={() => setPeriod('quarter')}
          />
        </View>

        {summary.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : summary.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(summary.error, 'Could not load insights')}
          </Text>
        ) : summary.data ? (
          <View className="gap-3">
            <View className="flex-row gap-3 flex-wrap">
              <StatTile title="Intros" value={summary.data.intros_new} subtitle="new this period" />
              <StatTile title="Expiring soon" value={summary.data.expiring_soon} subtitle="≤ 7 days" />
              <StatTile title="Expired" value={summary.data.expired} subtitle="no live access" />
            </View>

            {summary.data.billing_live ? (
              <View className="flex-row gap-3 flex-wrap">
                <StatTile
                  title="Paying"
                  value={summary.data.paying_now}
                  subtitle="ever paid"
                />
                <ConversionTile
                  conversions={summary.data.conversions}
                  target={summary.data.conversions_target}
                />
              </View>
            ) : (
              <View className="flex-row gap-3 flex-wrap">
                <BillingNotLiveTile title="Paying" />
                <BillingNotLiveTile title="Conversion" />
              </View>
            )}

            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              Period: {start} → {end}. Intros target:{' '}
              {summary.data.intros_target > 0
                ? `${summary.data.intros_new} / ${summary.data.intros_target}`
                : 'not set'}
              .
            </Text>
          </View>
        ) : null}

        {canSetTargets ? <TargetsSection /> : null}
      </ScrollView>
    </Screen>
  );
}

function TargetsSection() {
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
        metric: TargetMetric;
        period: Period;
        target_value: number;
        updated_by: string;
      }[] = [];
      for (const m of TARGET_METRICS) {
        for (const p of TARGET_PERIODS) {
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

  return (
    <View className="gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
          Targets
        </Text>
        <Text className="text-gray-500 dark:text-gray-400">
          Set monthly and quarterly goals. The tiles above show progress
          against these.
        </Text>
      </View>

      <View className="gap-4">
        {TARGET_METRICS.map((m) => (
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
              {TARGET_PERIODS.map((p) => {
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
    </View>
  );
}

function PeriodTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 py-2 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <Text
        className={
          active ? 'text-primary font-medium' : 'text-gray-500 dark:text-gray-400'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function ConversionTile({
  conversions,
  target,
}: {
  conversions: number;
  target: number;
}) {
  const hasTarget = target > 0;
  const ratio = hasTarget ? Math.min(1, conversions / target) : 0;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 flex-1 min-w-[150px]">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Conversion
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
        {conversions}
        {hasTarget ? (
          <Text className="text-gray-500 dark:text-gray-400 text-lg"> / {target}</Text>
        ) : null}
      </Text>
      {hasTarget ? (
        <View className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <View
            className="h-full bg-primary"
            style={{ width: `${ratio * 100}%` }}
          />
        </View>
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Target not set
        </Text>
      )}
    </View>
  );
}
