import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

import {
  DateRangeCta,
  isoDate,
  presetRange,
  type Preset,
} from './DateRangeCta';
import { ChipButton } from '@/components/ChipButton';
import { useGymMembership, useSession } from '@/lib/auth';
import {
  formatMoney,
  totalEarnings,
  type EarningsRow,
} from '@/lib/coach-earnings';
import { supabase } from '@/lib/supabase';

// Shown on the coach's own Account screen. Period defaults to "this
// month"; member can switch via the standard DateRangeCta.
export function CoachEarningsCard() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);

  const earnings = useQuery({
    queryKey: [
      'coach-earnings',
      membership?.gymId,
      session?.user.id,
      range.start,
      range.end,
    ],
    enabled: !!membership?.gymId && !!session?.user.id,
    queryFn: async (): Promise<EarningsRow[]> => {
      const { data, error } = await supabase.rpc('compute_coach_earnings', {
        p_gym_id: membership!.gymId,
        p_coach_id: session!.user.id,
        p_period_start: new Date(`${range.start}T00:00:00`).toISOString(),
        p_period_end: new Date(`${range.end}T00:00:00`).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as EarningsRow[];
    },
  });

  const rows = earnings.data ?? [];
  const totals = totalEarnings(rows);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Earnings
        </Text>
      </View>
      <DateRangeCta
        preset={preset}
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        onChange={(next) => {
          if (next.preset === 'custom') {
            setPreset('custom');
            setCustomStart(next.start);
            setCustomEnd(next.end);
          } else {
            setPreset(next.preset);
          }
        }}
      />
      {earnings.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
      ) : (
        <View className="gap-2">
          <View className="flex-row items-baseline gap-3">
            <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
              {formatMoney(totals.cents, totals.currency)}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {totals.classes} {totals.classes === 1 ? 'class' : 'classes'}
            </Text>
          </View>
          {rows.length > 0 ? (
            <ChipButton
              className="self-start"
              label={breakdownOpen ? 'Hide breakdown' : 'Show breakdown'}
              icon={breakdownOpen ? 'chevron-up' : 'chevron-down'}
              onPress={() => setBreakdownOpen((v) => !v)}
            />
          ) : null}
          {breakdownOpen ? (
            <View className="gap-1.5 pt-1">
              {rows.map((r) => (
                <View
                  key={r.class_type_id}
                  className="flex-row items-center gap-2">
                  <View
                    style={{ backgroundColor: r.class_type_color }}
                    className="w-2 h-2 rounded-full"
                  />
                  <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm" numberOfLines={1}>
                    {r.class_type_name}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {r.class_count} ·{' '}
                    {r.rate_cents > 0
                      ? formatMoney(r.rate_cents, r.currency)
                      : 'no rate'}
                  </Text>
                  <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                    {formatMoney(r.earnings_cents, r.currency)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {rows.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-xs italic">
              No classes or rates yet in this period.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
