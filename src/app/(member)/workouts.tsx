import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { LogWorkoutModal } from '@/components/LogWorkoutModal';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type TrackedMetric = 'weight' | 'reps' | 'time' | 'distance' | 'calories' | 'rounds';

type LogResult = {
  metric_kind: TrackedMetric;
  value_numeric: number | null;
  value_seconds: number | null;
  value_reps: number | null;
  is_rx: boolean;
  is_pr: boolean;
  movements: { name: string } | null;
};

type Log = {
  log_id: string;
  logged_at: string;
  programmed_at: string | null;
  notes: string | null;
  workout_log_results: LogResult[];
};

function fmtResult(r: LogResult): string {
  const m = r.movements?.name ?? 'Unknown';
  switch (r.metric_kind) {
    case 'time': {
      const s = r.value_seconds ?? 0;
      const mm = Math.floor(s / 60).toString();
      const ss = (s % 60).toString().padStart(2, '0');
      return `${m} · ${mm}:${ss}`;
    }
    case 'reps':
      return `${m} · ${r.value_reps ?? 0} reps`;
    case 'weight':
      return `${m} · ${r.value_numeric ?? 0} kg`;
    case 'distance':
      return `${m} · ${r.value_numeric ?? 0} m`;
    case 'calories':
      return `${m} · ${r.value_numeric ?? 0} cal`;
    case 'rounds':
      return `${m} · ${r.value_numeric ?? 0} rounds`;
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function Workouts() {
  const session = useSession();
  const [logOpen, setLogOpen] = useState(false);

  const logsQuery = useQuery({
    queryKey: ['workout-logs', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Log[]> => {
      const { data, error } = await supabase
        .from('workout_logs')
        .select(
          'log_id, logged_at, programmed_at, notes, workout_log_results(metric_kind, value_numeric, value_seconds, value_reps, is_rx, is_pr, movements(name))',
        )
        .order('logged_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Log[];
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="flex-row items-end justify-between">
          <View className="gap-1 flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Workouts
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Your training history and personal records.
            </Text>
          </View>
          <View>
            <Button onPress={() => setLogOpen(true)}>Log workout</Button>
          </View>
        </View>

        {logsQuery.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : null}

        {logsQuery.data?.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              No logs yet
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Log results after class to start your training history.
            </Text>
          </View>
        ) : null}

        {logsQuery.data?.map((log) => (
          <Pressable
            key={log.log_id}
            className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 active:bg-gray-50 dark:active:bg-gray-800">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              {fmtDate(log.logged_at)}
            </Text>
            <View className="gap-1">
              {log.workout_log_results.map((r, i) => (
                <View key={i} className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-gray-900 dark:text-gray-50">
                    {fmtResult(r)}
                  </Text>
                  {r.is_pr ? (
                    <View className="bg-amber-100 dark:bg-amber-900/40 rounded-full px-2 py-0.5">
                      <Text className="text-amber-800 dark:text-amber-200 text-xs font-medium">
                        PR
                      </Text>
                    </View>
                  ) : null}
                  {r.is_rx ? null : (
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">
                      scaled
                    </Text>
                  )}
                </View>
              ))}
            </View>
            {log.notes ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">{log.notes}</Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      <LogWorkoutModal visible={logOpen} onClose={() => setLogOpen(false)} />
    </Screen>
  );
}
