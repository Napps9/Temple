import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BillingNotLiveTile } from '@/components/BillingNotLiveTile';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import {
  DateRangeCta,
  type Preset,
  isoDate,
  presetRange,
} from '@/components/DateRangeCta';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';

// "Target period" — distinct from the page-level date picker. Targets
// are configured per week/month/quarter/year on gym_insight_targets;
// the page picker can show any date range and the
// compute_insight_summary RPC picks the right target row based on
// the range length.
type TargetPeriod = 'week' | 'month' | 'quarter' | 'year';
type TargetUnit = 'count' | 'rate';

type Summary = {
  intros_new: number;
  intros_target: number;
  conversions: number;
  conversions_target: number;
  conversions_target_unit: TargetUnit;
  retention_now: number;
  retention_base: number;
  retention_target: number;
  retention_target_unit: TargetUnit;
  lead_conversions: number;
  expiring_soon: number;
  expired: number;
  paying_now: number;
  billing_live: boolean;
};

type TargetMetric = 'intros_new' | 'conversions' | 'retention';

type TargetRow = {
  metric: TargetMetric;
  period: TargetPeriod;
  target_value: number;
  unit: TargetUnit;
};

const TARGET_METRICS: {
  value: TargetMetric;
  label: string;
  description: string;
  supportsRate: boolean;
}[] = [
  {
    value: 'intros_new',
    label: 'New intros',
    description: 'Members starting an intro period (e.g. trial, foundations).',
    supportsRate: false,
  },
  {
    value: 'conversions',
    label: 'Conversions',
    description: 'Intros who became paying members in the period.',
    supportsRate: true,
  },
  {
    value: 'retention',
    label: 'Retention',
    description: 'Members who stay active across the period.',
    supportsRate: true,
  },
];

const TARGET_PERIODS: TargetPeriod[] = ['week', 'month', 'quarter', 'year'];
const TARGET_PERIOD_LABELS: Record<TargetPeriod, string> = {
  week: 'Per week',
  month: 'Per month',
  quarter: 'Per quarter',
  year: 'Per year',
};

export default function InsightsScreen() {
  const { data: membership } = useGymMembership();
  const canSeeInsights = useCan('can_see_insights');
  const canSetTargets = useCan('can_set_targets');

  // Same six-preset picker the manage dashboard uses, threaded through
  // the shared DateRangeCta. Custom ranges are committed via the
  // modal's Apply button so the summary query doesn't re-fire on each
  // keystroke.
  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);
  const { start, end } = range;

  const summary = useQuery({
    queryKey: ['insights-summary', membership?.gymId, preset, start, end],
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
          conversions_target_unit: 'count',
          retention_now: 0,
          retention_base: 0,
          retention_target: 0,
          retention_target_unit: 'count',
          lead_conversions: 0,
          expiring_soon: 0,
          expired: 0,
          paying_now: 0,
          billing_live: false,
        };
      }
      return rows[0];
    },
  });

  // Per-source breakdown of converted leads in the period. Surfaced
  // alongside the lead_conversions tile so owners can tell which
  // acquisition channels are paying off.
  const leadBySource = useQuery({
    queryKey: ['insights-leads-by-source', membership?.gymId, start, end],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('source_id, source:lead_sources!source_id(label, color)')
        .eq('gym_id', membership!.gymId)
        .gte('converted_at', start)
        .lte('converted_at', `${end}T23:59:59`);
      if (error) throw error;
      const tally = new Map<string, { label: string; color: string; n: number }>();
      let untagged = 0;
      for (const row of data ?? []) {
        const r = row as unknown as {
          source_id: string | null;
          source: { label: string; color: string } | null;
        };
        if (!r.source_id || !r.source) {
          untagged += 1;
          continue;
        }
        const existing = tally.get(r.source_id);
        if (existing) existing.n += 1;
        else
          tally.set(r.source_id, {
            label: r.source.label,
            color: r.source.color,
            n: 1,
          });
      }
      return {
        untagged,
        sources: [...tally.values()].sort((a, b) => b.n - a.n),
      };
    },
  });

  if (canSeeInsights === false) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Insights
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Lifecycle cohorts for your gym — intros, who's expiring soon,
            and conversion against your targets.
          </Text>
        </View>

        <DateRangeCta
          preset={preset}
          range={range}
          customStart={customStart}
          customEnd={customEnd}
          onChange={(next) => {
            setPreset(next.preset);
            if (next.preset === 'custom') {
              setCustomStart(next.start);
              setCustomEnd(next.end);
            }
          }}
        />

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
              <StatTile title="Leads converted" value={summary.data.lead_conversions} subtitle="in this period" />
              <StatTile title="Expiring soon" value={summary.data.expiring_soon} subtitle="≤ 7 days" />
              <StatTile title="Expired" value={summary.data.expired} subtitle="no live access" />
            </View>

            {(leadBySource.data?.sources.length ?? 0) > 0 ||
            (leadBySource.data?.untagged ?? 0) > 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Conversions by source
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {leadBySource.data!.sources.map((s) => (
                    <View
                      key={s.label}
                      style={{ backgroundColor: s.color + '22' }}
                      className="rounded-full px-3 py-1 flex-row items-center gap-1.5">
                      <View
                        style={{ backgroundColor: s.color }}
                        className="w-2 h-2 rounded-full"
                      />
                      <Text
                        style={{ color: s.color }}
                        className="text-xs font-semibold">
                        {s.label}
                      </Text>
                      <Text
                        style={{ color: s.color }}
                        className="text-xs">
                        · {s.n}
                      </Text>
                    </View>
                  ))}
                  {leadBySource.data!.untagged > 0 ? (
                    <View className="rounded-full px-3 py-1 bg-gray-100 dark:bg-gray-800 flex-row items-center gap-1.5">
                      <Text className="text-gray-600 dark:text-gray-300 text-xs font-semibold">
                        No source
                      </Text>
                      <Text className="text-gray-500 dark:text-gray-400 text-xs">
                        · {leadBySource.data!.untagged}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {summary.data.billing_live ? (
              <View className="flex-row gap-3 flex-wrap">
                <StatTile
                  title="Paying"
                  value={summary.data.paying_now}
                  subtitle="ever paid"
                />
                <ConversionTile
                  conversions={summary.data.conversions}
                  introsNew={summary.data.intros_new}
                  target={summary.data.conversions_target}
                  targetUnit={summary.data.conversions_target_unit}
                />
              </View>
            ) : (
              <View className="flex-row gap-3 flex-wrap">
                <BillingNotLiveTile title="Paying" />
                <BillingNotLiveTile title="Conversion" />
              </View>
            )}

            <View className="flex-row gap-3 flex-wrap">
              <RetentionTile
                retained={summary.data.retention_now}
                base={summary.data.retention_base}
                target={summary.data.retention_target}
                targetUnit={summary.data.retention_target_unit}
              />
            </View>

            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              Period: {start} → {end}. Intros target:{' '}
              {summary.data.intros_target > 0
                ? `${summary.data.intros_new} / ${summary.data.intros_target}`
                : 'not set'}
              .
            </Text>
          </View>
        ) : null}

        {canSetTargets ? <TargetsLauncher /> : null}
      </ScrollView>
    </Screen>
  );
}

// Owners rarely need to revisit targets after initial setup, so tuck
// the editor behind a "Configure targets" CTA — same launcher pattern
// as RolePermissionsLauncher on the Team screen, for consistency.
function TargetsLauncher() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <View className="mt-4">
        <Button variant="secondary" onPress={() => setOpen(true)}>
          Configure targets
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-3">
      <TargetsSection />
      <View className="self-start">
        <ChipButton
          label="Hide targets"
          icon="chevron-up-outline"
          tone="neutral"
          onPress={() => setOpen(false)}
        />
      </View>
    </View>
  );
}

const DEFAULT_UNITS: Record<TargetMetric, TargetUnit> = {
  intros_new: 'count',
  conversions: 'count',
  retention: 'count',
};

const DEFAULT_ACTIVE_PERIOD: Record<TargetMetric, TargetPeriod> = {
  intros_new: 'month',
  conversions: 'month',
  retention: 'month',
};

function TargetsSection() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<TargetMetric, TargetUnit>>(DEFAULT_UNITS);
  const [activePeriod, setActivePeriod] =
    useState<Record<TargetMetric, TargetPeriod>>(DEFAULT_ACTIVE_PERIOD);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const targetsQuery = useQuery({
    queryKey: ['insight-targets', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_insight_targets')
        .select('metric, period, target_value, unit')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  useEffect(() => {
    if (!targetsQuery.data) return;
    const next: Record<string, string> = {};
    const nextUnits = { ...DEFAULT_UNITS };
    for (const t of targetsQuery.data) {
      next[`${t.metric}-${t.period}`] = String(t.target_value);
      nextUnits[t.metric] = t.unit;
    }
    setValues(next);
    setUnits(nextUnits);
    // Land on whichever period already has a saved value, so an owner
    // who set a quarterly target opens the editor and sees it — not an
    // empty "Month" box.
    const nextActive = { ...DEFAULT_ACTIVE_PERIOD };
    for (const m of TARGET_METRICS) {
      const withValue = TARGET_PERIODS.find((p) => next[`${m.value}-${p}`] !== undefined);
      if (withValue) nextActive[m.value] = withValue;
    }
    setActivePeriod(nextActive);
  }, [targetsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      const toUpsert: {
        gym_id: string;
        metric: TargetMetric;
        period: TargetPeriod;
        target_value: number;
        unit: TargetUnit;
        updated_by: string;
      }[] = [];
      for (const m of TARGET_METRICS) {
        const unit = units[m.value];
        for (const p of TARGET_PERIODS) {
          const key = `${m.value}-${p}`;
          const raw = values[key]?.trim() ?? '';
          if (raw.length === 0) continue;
          const n = Number.parseInt(raw, 10);
          if (!Number.isFinite(n) || n < 0 || (unit === 'rate' && n > 100)) {
            throw new Error(
              unit === 'rate'
                ? `${m.label} (${p}): must be a percentage between 0 and 100`
                : `${m.label} (${p}): must be a non-negative integer`,
            );
          }
          toUpsert.push({
            gym_id: membership.gymId,
            metric: m.value,
            period: p,
            target_value: n,
            unit,
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
          Set goals per week, month, quarter or year. The tiles above show
          progress against these.
        </Text>
      </View>

      <View className="gap-4">
        {TARGET_METRICS.map((m) => (
          <View
            key={m.value}
            className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <View className="flex-row items-start justify-between gap-2">
              <View className="gap-1 flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {m.label}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {m.description}
                </Text>
              </View>
              {m.supportsRate ? (
                <UnitToggle
                  value={units[m.value]}
                  onChange={(u) => setUnits({ ...units, [m.value]: u })}
                />
              ) : null}
            </View>
            <TargetInput
              period={activePeriod[m.value]}
              unit={units[m.value]}
              value={values[`${m.value}-${activePeriod[m.value]}`] ?? ''}
              onChangeText={(v) =>
                setValues({
                  ...values,
                  [`${m.value}-${activePeriod[m.value]}`]: v,
                })
              }
            />
            <PeriodToggle
              value={activePeriod[m.value]}
              onChange={(p) => setActivePeriod({ ...activePeriod, [m.value]: p })}
            />
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

function TargetInput({
  period,
  unit,
  value,
  onChangeText,
}: {
  period: TargetPeriod;
  unit: TargetUnit;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View className="flex-1">
      <Input
        label={`${TARGET_PERIOD_LABELS[period]}${unit === 'rate' ? ' (%)' : ''}`}
        value={value}
        onChangeText={onChangeText}
        placeholder={unit === 'rate' ? '0-100' : '0'}
        keyboardType="number-pad"
      />
    </View>
  );
}

function UnitToggle({
  value,
  onChange,
}: {
  value: TargetUnit;
  onChange: (u: TargetUnit) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {(['count', 'rate'] as const).map((u) => {
        const active = value === u;
        return (
          <Pressable
            key={u}
            onPress={() => onChange(u)}
            className={`px-3 py-1 rounded-full border ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}>
            <Text
              className={`text-xs font-semibold ${
                active ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
              }`}>
              {u === 'count' ? 'Count' : 'Rate %'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: TargetPeriod;
  onChange: (p: TargetPeriod) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {TARGET_PERIODS.map((p) => {
        const active = value === p;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            className={`px-3 py-1 rounded-full border ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}>
            <Text
              className={`capitalize text-xs font-semibold ${
                active ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
              }`}>
              {p}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ConversionTile({
  conversions,
  introsNew,
  target,
  targetUnit,
}: {
  conversions: number;
  introsNew: number;
  target: number;
  targetUnit: TargetUnit;
}) {
  const hasTarget = target > 0;
  const rate = introsNew > 0 ? (conversions / introsNew) * 100 : 0;
  const actual = targetUnit === 'rate' ? rate : conversions;
  const ratio = hasTarget ? Math.min(1, actual / target) : 0;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 flex-1 min-w-[150px]">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Conversion
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
        {targetUnit === 'rate' ? `${rate.toFixed(0)}%` : conversions}
        {hasTarget ? (
          <Text className="text-gray-500 dark:text-gray-400 text-lg">
            {' '}
            / {target}
            {targetUnit === 'rate' ? '%' : ''}
          </Text>
        ) : null}
      </Text>
      {targetUnit === 'rate' ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {conversions} of {introsNew} intros
        </Text>
      ) : null}
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

function RetentionTile({
  retained,
  base,
  target,
  targetUnit,
}: {
  retained: number;
  base: number;
  target: number;
  targetUnit: TargetUnit;
}) {
  const hasTarget = target > 0;
  const rate = base > 0 ? (retained / base) * 100 : 0;
  const actual = targetUnit === 'rate' ? rate : retained;
  const ratio = hasTarget ? Math.min(1, actual / target) : 0;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2 flex-1 min-w-[150px]">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Retention
      </Text>
      <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
        {targetUnit === 'rate' ? `${rate.toFixed(0)}%` : retained}
        {hasTarget ? (
          <Text className="text-gray-500 dark:text-gray-400 text-lg">
            {' '}
            / {target}
            {targetUnit === 'rate' ? '%' : ''}
          </Text>
        ) : null}
      </Text>
      {targetUnit === 'rate' ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {retained} of {base} stayed active
        </Text>
      ) : null}
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
