import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BodyMap } from '@/components/BodyMap';
import { Screen } from '@/components/Screen';
import {
  computeMovementTrends,
  type MovementTrendSummary,
} from '@/lib/analysis';
import { useGymMembership } from '@/lib/auth';
import {
  daysAgo,
  injuryTitle,
  painColour,
  regionLabel,
  STATUS_META,
} from '@/lib/injuries';
import { findScheme, movementName } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { formatSeconds } from '@/lib/track';
import { useCan } from '@/lib/useCan';
import type { InjurySide, InjuryStatus } from '@/types/database';

const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

type OpenInjury = {
  id: string;
  profile_id: string;
  body_region: string;
  side: InjurySide;
  pain_level: number;
  status: InjuryStatus;
  movements_hurt: string[];
  updated_at: string;
  profiles: { full_name: string | null } | null;
};

type ResultRow = {
  profile_id: string;
  movement_key: string;
  track_key: string;
  value_numeric: number | null;
  value_seconds: number | null;
  performed_at: string;
};

// Coach-facing programming analysis: where the gym is hurting (open
// injuries on a body-map heat view) and how movements are trending
// per member and collectively, from deliberate PR logs over the last
// twelve weeks.
export default function AnalysisScreen() {
  const { data: membership } = useGymMembership();
  const canSeeHealth = useCan('can_see_health_flag') ?? false;
  const canSeeLogs = useCan('can_see_workout_logs') ?? false;

  const injuries = useQuery({
    queryKey: ['gym-open-injuries', membership?.gymId],
    enabled: !!membership?.gymId && canSeeHealth,
    queryFn: async (): Promise<OpenInjury[]> => {
      const { data, error } = await supabase
        .from('member_injuries')
        .select(
          'id, profile_id, body_region, side, pain_level, status, movements_hurt, updated_at, profiles!profile_id(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .neq('status', 'resolved')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OpenInjury[];
    },
  });

  const results = useQuery({
    queryKey: ['gym-movement-results', membership?.gymId],
    enabled: !!membership?.gymId && canSeeLogs,
    queryFn: async (): Promise<ResultRow[]> => {
      const sinceIso = new Date(Date.now() - TWELVE_WEEKS_MS).toISOString();
      const { data, error } = await supabase
        .from('tracked_movement_results')
        .select(
          'profile_id, movement_key, track_key, value_numeric, value_seconds, performed_at',
        )
        .eq('gym_id', membership!.gymId)
        .gte('performed_at', sinceIso);
      if (error) throw error;
      return (data ?? []) as ResultRow[];
    },
  });

  const names = useQuery({
    queryKey: ['gym-member-names', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .is('left_at', null);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as unknown as {
        profile_id: string;
        profiles: { full_name: string | null } | null;
      }[]) {
        map.set(r.profile_id, r.profiles?.full_name ?? 'Member');
      }
      return map;
    },
  });

  const trends = useMemo(() => {
    const points = (results.data ?? [])
      .map((r) => {
        const metric = findScheme(r.movement_key, r.track_key)?.metric;
        const value = metric === 'time' ? r.value_seconds : r.value_numeric;
        if (value == null) return null;
        return {
          profile_id: r.profile_id,
          movement_key: r.movement_key,
          track_key: r.track_key,
          value,
          performed_at: r.performed_at,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    return computeMovementTrends(
      points,
      (m, t) => findScheme(m, t)?.better ?? 'higher',
    );
  }, [results.data]);

  const open = injuries.data ?? [];

  // Heat tint per region: more open injuries = hotter.
  const highlights = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of open)
      counts.set(r.body_region, (counts.get(r.body_region) ?? 0) + 1);
    const map: Record<string, string> = {};
    for (const [region, n] of counts)
      map[region] = n >= 3 ? '#EF4444' : n === 2 ? '#F97316' : '#F59E0B';
    return { map, counts };
  }, [open]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-2 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Programming analysis
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Open injuries across the gym, and how movements are trending.
          </Text>
        </View>

        {/* ----------------------------- Injuries ----------------------------- */}
        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Injury map
          </Text>
          {!canSeeHealth ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You don't have permission to view health data.
            </Text>
          ) : (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
              <BodyMap highlights={highlights.map} />
              {open.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
                  No open injuries. Happy days.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-1 justify-center">
                  {[...highlights.counts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([region, n]) => (
                      <View
                        key={region}
                        style={{ borderColor: highlights.map[region] }}
                        className="rounded-full border px-2 py-0.5">
                        <Text
                          style={{ color: highlights.map[region] }}
                          className="text-[10px] font-semibold">
                          {regionLabel(region)} · {n}
                        </Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          {open.map((r) => (
            <Pressable
              key={r.id}
              onPress={() =>
                router.push(`/management/members/${r.profile_id}` as never)
              }
              className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
              <View
                style={{ backgroundColor: painColour(r.pain_level) }}
                className="w-7 h-7 rounded-full items-center justify-center">
                <Text className="text-white text-[11px] font-bold">
                  {r.pain_level}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {r.profiles?.full_name ?? 'Member'} —{' '}
                  {injuryTitle(r.body_region, r.side).toLowerCase()}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {STATUS_META[r.status].label} · updated{' '}
                  {daysAgo(r.updated_at) === 0
                    ? 'today'
                    : `${daysAgo(r.updated_at)}d ago`}
                  {r.movements_hurt.length > 0
                    ? ` · avoid ${r.movements_hurt
                        .slice(0, 3)
                        .map(movementName)
                        .join(', ')}${r.movements_hurt.length > 3 ? '…' : ''}`
                    : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Pressable>
          ))}
        </View>

        {/* ------------------------- Movement trends -------------------------- */}
        <View className="gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Movement trends
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            First vs latest logged result per member over the last 12
            weeks, from the movement tracker.
          </Text>
          {!canSeeLogs ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You don't have permission to view workout logs.
            </Text>
          ) : results.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : trends.length === 0 ? (
            <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Not enough logged results yet — trends need at least two
                results per member on a movement.
              </Text>
            </View>
          ) : (
            trends.map((t) => (
              <TrendCard
                key={`${t.movement_key}-${t.track_key}`}
                trend={t}
                nameOf={(id) => names.data?.get(id) ?? 'Member'}
              />
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function fmtValue(movementKey: string, trackKey: string, v: number): string {
  const metric = findScheme(movementKey, trackKey)?.metric;
  if (metric === 'time') return formatSeconds(v);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}`;
}

function TrendCard({
  trend,
  nameOf,
}: {
  trend: MovementTrendSummary;
  nameOf: (profileId: string) => string;
}) {
  const [openCard, setOpenCard] = useState(false);
  const scheme = findScheme(trend.movement_key, trend.track_key);
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl">
      <Pressable
        onPress={() => setOpenCard((v) => !v)}
        className="p-4 gap-1 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
            {movementName(trend.movement_key)}
            <Text className="text-gray-400 dark:text-gray-500 font-normal">
              {'  '}
              {scheme?.label ?? trend.track_key}
            </Text>
          </Text>
          <Ionicons
            name={openCard ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#9CA3AF"
          />
        </View>
        <View className="flex-row items-center gap-3">
          <TrendStat icon="trending-up" colour="#10B981" n={trend.improving} />
          <TrendStat icon="trending-down" colour="#EF4444" n={trend.declining} />
          <TrendStat icon="remove" colour="#9CA3AF" n={trend.flat} />
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            {trend.members.length}{' '}
            {trend.members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </Pressable>
      {openCard ? (
        <View className="px-4 pb-3 gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-2">
          {trend.members.map((m) => (
            <View key={m.profile_id} className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-gray-700 dark:text-gray-200 text-sm"
                numberOfLines={1}>
                {nameOf(m.profile_id)}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {fmtValue(trend.movement_key, trend.track_key, m.first)} →{' '}
                {fmtValue(trend.movement_key, trend.track_key, m.last)}
              </Text>
              <View
                className={`rounded-full px-2 py-0.5 ${
                  m.trend === 'improving'
                    ? 'bg-emerald-500/10'
                    : m.trend === 'declining'
                      ? 'bg-red-500/10'
                      : 'bg-gray-500/10'
                }`}>
                <Text
                  className={`text-[10px] font-bold ${
                    m.trend === 'improving'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : m.trend === 'declining'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}>
                  {m.deltaPct === null
                    ? '—'
                    : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TrendStat({
  icon,
  colour,
  n,
}: {
  icon: 'trending-up' | 'trending-down' | 'remove';
  colour: string;
  n: number;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={13} color={colour} />
      <Text style={{ color: colour }} className="text-xs font-semibold">
        {n}
      </Text>
    </View>
  );
}
