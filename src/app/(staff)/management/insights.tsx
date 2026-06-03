import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BillingNotLiveTile } from '@/components/BillingNotLiveTile';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

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
  const role = useRole();
  const { data: membership } = useGymMembership();
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

  if (role && !can(role, 'can_see_insights')) {
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
              <Tile title="Intros" value={summary.data.intros_new} subtitle="new this period" />
              <Tile title="Expiring soon" value={summary.data.expiring_soon} subtitle="≤ 7 days" />
              <Tile title="Expired" value={summary.data.expired} subtitle="no live access" />
            </View>

            {summary.data.billing_live ? (
              <View className="flex-row gap-3 flex-wrap">
                <Tile
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
      </ScrollView>
    </Screen>
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

function Tile({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number;
  subtitle?: string;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 flex-1 min-w-[150px]">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        {title}
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
        {value}
      </Text>
      {subtitle ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{subtitle}</Text>
      ) : null}
    </View>
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
