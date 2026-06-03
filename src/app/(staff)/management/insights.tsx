import { useMutation, useQuery } from '@tanstack/react-query';
import { Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useState } from 'react';

type BucketCount = { bucket: string; count: number };
type FunnelRow = {
  grants_issued: number;
  grants_converted: number;
  conversion_rate: number;
};
type AttendanceRow = {
  week_start: string;
  class_type_id: string | null;
  class_type_name: string | null;
  bookings_count: number;
  unique_members: number;
};

const BUCKET_LABELS: Record<string, { label: string; tone: string }> = {
  intro: { label: 'Intros', tone: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-200' },
  active: { label: 'Active', tone: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-200' },
  paused: { label: 'Paused', tone: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200' },
  expiring: { label: 'Expiring (14d)', tone: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-200' },
  expired: { label: 'Expired (30d)', tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' },
  lapsed: { label: 'Lapsed', tone: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200' },
};

function fmtWeek(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export default function Insights() {
  const { data: gym } = useGymMembership();
  const role = useRole();
  const [exportError, setExportError] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: async (kind: 'members' | 'subscriptions') => {
      if (!gym?.gymId) throw new Error('No gym');
      const { data, error } = await supabase.functions.invoke<string>('exports', {
        body: { gymId: gym.gymId, kind },
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('No data returned');
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        throw new Error('CSV export is currently web-only — open Temple on desktop.');
      }
    },
    onError: (err) => setExportError(errorMessage(err)),
    onSuccess: () => setExportError(null),
  });

  const lifecycleQuery = useQuery({
    queryKey: ['insights-lifecycle', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<BucketCount[]> => {
      const { data, error } = await supabase.rpc('get_lifecycle_bucket_counts', {
        p_gym_id: gym!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as BucketCount[];
    },
  });

  const funnelQuery = useQuery({
    queryKey: ['insights-funnel', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<FunnelRow | null> => {
      const { data, error } = await supabase.rpc('get_conversion_funnel', {
        p_gym_id: gym!.gymId,
        p_since: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as FunnelRow | null) ?? null;
    },
  });

  const attendanceQuery = useQuery({
    queryKey: ['insights-attendance', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<AttendanceRow[]> => {
      const { data, error } = await supabase.rpc('get_attendance_weekly', {
        p_gym_id: gym!.gymId,
        p_weeks: 12,
      });
      if (error) throw error;
      return (data ?? []) as AttendanceRow[];
    },
  });

  const weeklyTotals = (attendanceQuery.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.week_start] = (acc[row.week_start] ?? 0) + row.bookings_count;
      return acc;
    },
    {},
  );
  const weekKeys = Object.keys(weeklyTotals).sort().reverse().slice(0, 12);
  const maxWeekly = Math.max(0, ...Object.values(weeklyTotals));

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Insights
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Lifecycle, conversion, and attendance for your gym.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Member lifecycle
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(lifecycleQuery.data ?? []).map((b) => {
              const cfg = BUCKET_LABELS[b.bucket] ?? {
                label: b.bucket,
                tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
              };
              return (
                <View
                  key={b.bucket}
                  className={`rounded-lg px-3 py-2 gap-0.5 min-w-[100px] ${cfg.tone}`}>
                  <Text className={`text-xs ${cfg.tone}`}>{cfg.label}</Text>
                  <Text className={`text-lg font-semibold ${cfg.tone}`}>
                    {b.count}
                  </Text>
                </View>
              );
            })}
            {lifecycleQuery.data?.length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No members yet.
              </Text>
            ) : null}
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Intro → paid conversion
          </Text>
          {funnelQuery.data ? (
            <View className="flex-row gap-6">
              <Stat label="Intros" value={funnelQuery.data.grants_issued.toString()} />
              <Stat label="Converted" value={funnelQuery.data.grants_converted.toString()} />
              <Stat
                label="Rate"
                value={`${funnelQuery.data.conversion_rate ?? 0}%`}
              />
            </View>
          ) : (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">No grants yet.</Text>
          )}
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Converted within 90 days of the comp grant being issued.
          </Text>
        </View>

        {can(role, 'can_see_money') ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <View className="gap-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Export to CSV
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Members and subscription snapshots for your own analysis.
              </Text>
            </View>
            <View className="flex-row gap-3 flex-wrap">
              <View className="flex-1 min-w-[140px]">
                <Button
                  variant="secondary"
                  onPress={() => exportMutation.mutate('members')}
                  loading={exportMutation.isPending && exportMutation.variables === 'members'}>
                  Members
                </Button>
              </View>
              <View className="flex-1 min-w-[140px]">
                <Button
                  variant="secondary"
                  onPress={() => exportMutation.mutate('subscriptions')}
                  loading={exportMutation.isPending && exportMutation.variables === 'subscriptions'}>
                  Subscriptions
                </Button>
              </View>
            </View>
            {exportError ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {exportError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Attendance — last 12 weeks
          </Text>
          {weekKeys.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No bookings yet.
            </Text>
          ) : (
            <View className="gap-1">
              {weekKeys.map((w) => {
                const value = weeklyTotals[w];
                const widthPct = maxWeekly > 0 ? (value / maxWeekly) * 100 : 0;
                return (
                  <View key={w} className="flex-row items-center gap-2">
                    <Text className="text-gray-500 dark:text-gray-400 text-xs w-16">
                      {fmtWeek(w)}
                    </Text>
                    <View className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded">
                      <View
                        className="h-3 bg-primary rounded"
                        style={{ width: `${widthPct}%` }}
                      />
                    </View>
                    <Text className="text-gray-900 dark:text-gray-50 text-xs w-10 text-right">
                      {value}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5">
      <Text className="text-gray-500 dark:text-gray-400 text-xs">{label}</Text>
      <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
        {value}
      </Text>
    </View>
  );
}
