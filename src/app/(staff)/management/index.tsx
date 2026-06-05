import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { DatePicker } from '@/components/DatePicker';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { useGymMembership, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type LinkHref = ComponentProps<typeof Link>['href'];

function ManagementCard({
  title,
  description,
  href,
  comingSoon,
}: {
  title: string;
  description: string;
  href?: LinkHref;
  comingSoon?: boolean;
}) {
  const body = (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
      <View className="flex-row justify-between items-center">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">{title}</Text>
        {comingSoon ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Coming soon
          </Text>
        ) : (
          <Text className="text-primary">→</Text>
        )}
      </View>
      <Text className="text-gray-500 dark:text-gray-400">{description}</Text>
    </View>
  );
  if (href && !comingSoon) {
    return (
      <Link href={href} asChild>
        <Pressable>{body}</Pressable>
      </Link>
    );
  }
  return body;
}

export default function ManagementHome() {
  const role = useRole();
  const canSeeInsights = useCan('can_see_insights');
  const canViewAttendance = useCan('can_view_attendance');
  const canManageTasks = useCan('can_manage_tasks');
  const canRequestCover = useCan('can_request_cover');
  const canClaimCover = useCan('can_claim_cover');
  const canViewSops = useCan('can_view_sops');
  const canManageStaff = useCan('can_manage_staff');
  const canEditClasses = useCan('can_edit_classes');
  const canManageTags = useCan('can_manage_tags');
  const canManagePlans = useCan('can_manage_plans');

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <KeyStats />
        {canSeeInsights ? (
          <ManagementCard
            title="Insights"
            description="Intros, expiring members, conversion vs targets."
            href="/management/insights"
          />
        ) : null}
        {canViewAttendance ? (
          <ManagementCard
            title="Attendance"
            description="Trends from check-ins on class bookings."
            href="/management/attendance"
          />
        ) : null}
        {canManageTasks || role === 'staff' ? (
          <ManagementCard
            title="Tasks"
            description="Day-to-day staff work, assigned and tracked."
            href="/management/tasks"
          />
        ) : null}
        {canRequestCover || canClaimCover ? (
          <ManagementCard
            title="Cover"
            description="Hand a class to another coach; first-claim wins."
            href="/management/cover"
          />
        ) : null}
        {canViewSops ? (
          <ManagementCard
            title="SOPs"
            description="How we do things here — for the whole team."
            href="/management/sops"
          />
        ) : null}
        {canManageStaff ? (
          <ManagementCard
            title="Team"
            description="Invite owners, coaches, staff and members."
            href="/management/team"
          />
        ) : null}
        {canEditClasses ? (
          <ManagementCard
            title="Class types"
            description="Name and colour the kinds of class you run."
            href="/management/class-types"
          />
        ) : null}
        {canManageTags ? (
          <ManagementCard
            title="Members"
            description="View members by cohort, see and edit their tags."
            href="/management/members"
          />
        ) : null}
        {canManageTags ? (
          <ManagementCard
            title="Tag rules"
            description="Auto-tag members based on cohort state."
            href="/management/tags"
          />
        ) : null}
        {canManagePlans ? (
          <ManagementCard
            title="Plans"
            description="Define your membership plans, prices, and credit packs."
            href="/management/plans"
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ============================================================================
// Key stats — at-a-glance KPIs on the manage page, with a shared date filter.
// ============================================================================

type Preset = 'month' | 'quarter' | 'year' | '7d' | '30d' | 'custom';

const PRESET_LABELS: Record<Exclude<Preset, 'custom'>, string> = {
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(
  preset: Exclude<Preset, 'custom'>,
  today: Date,
): { start: string; end: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (preset === 'month') {
    return {
      start: isoDate(new Date(Date.UTC(y, m, 1))),
      end: isoDate(new Date(Date.UTC(y, m + 1, 0))),
    };
  }
  if (preset === 'quarter') {
    const q = Math.floor(m / 3);
    return {
      start: isoDate(new Date(Date.UTC(y, q * 3, 1))),
      end: isoDate(new Date(Date.UTC(y, q * 3 + 3, 0))),
    };
  }
  if (preset === 'year') {
    return {
      start: isoDate(new Date(Date.UTC(y, 0, 1))),
      end: isoDate(new Date(Date.UTC(y, 11, 31))),
    };
  }
  const days = preset === '7d' ? 7 : 30;
  const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: isoDate(start), end: isoDate(today) };
}

function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function KeyStats() {
  const { data: membership } = useGymMembership();

  const showRevenue = useCan('can_see_money') ?? false;
  const showInsights = useCan('can_see_insights') ?? false;
  const showAttendance = useCan('can_view_attendance') ?? false;

  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));

  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);

  const rangeValid =
    DATE_RE.test(range.start) && DATE_RE.test(range.end) && range.start <= range.end;

  const revenueQuery = useQuery({
    queryKey: ['manage-revenue', membership?.gymId, range.start, range.end],
    enabled: !!membership?.gymId && showRevenue && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_revenue_summary', {
        p_gym_id: membership!.gymId,
        p_period_start: range.start,
        p_period_end: range.end,
      });
      if (error) throw error;
      return (data ?? []) as {
        currency: string;
        gross_cents: number;
        charge_count: number;
      }[];
    },
  });

  const insightsQuery = useQuery({
    queryKey: ['manage-insights', membership?.gymId, range.start, range.end],
    enabled: !!membership?.gymId && showInsights && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_insight_summary', {
        p_gym_id: membership!.gymId,
        p_period_start: range.start,
        p_period_end: range.end,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        intros_new: number;
        intros_target: number;
        conversions: number;
        conversions_target: number;
        expiring_soon: number;
        expired: number;
        paying_now: number;
        billing_live: boolean;
      }[];
      return rows[0] ?? null;
    },
  });

  const attendanceQuery = useQuery({
    queryKey: ['manage-attendance', membership?.gymId, range.start, range.end],
    enabled: !!membership?.gymId && showAttendance && rangeValid,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('class_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId)
        .gte('attended_at', `${range.start}T00:00:00Z`)
        .lte('attended_at', `${range.end}T23:59:59Z`);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (!showRevenue && !showInsights && !showAttendance) return null;

  const queryError = revenueQuery.error ?? insightsQuery.error ?? attendanceQuery.error;

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as Exclude<Preset, 'custom'>[]).map((p) => (
          <PresetChip
            key={p}
            label={PRESET_LABELS[p]}
            active={preset === p}
            onPress={() => setPreset(p)}
          />
        ))}
        <PresetChip
          label="Custom"
          active={preset === 'custom'}
          onPress={() => setPreset('custom')}
        />
      </View>

      {preset === 'custom' ? (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <DatePicker label="From" value={customStart} onChange={setCustomStart} />
          </View>
          <View className="flex-1">
            <DatePicker label="To" value={customEnd} onChange={setCustomEnd} />
          </View>
        </View>
      ) : null}

      {!rangeValid ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          Pick valid dates with From on or before To.
        </Text>
      ) : null}

      {queryError ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(queryError, 'Could not load stats')}
        </Text>
      ) : null}

      {showRevenue ? (
        <RevenueRow
          rows={revenueQuery.data ?? []}
          loading={revenueQuery.isLoading}
        />
      ) : null}

      {showInsights ? (
        <InsightsRow data={insightsQuery.data ?? null} loading={insightsQuery.isLoading} />
      ) : null}

      {showAttendance ? (
        <View className="flex-row gap-3 flex-wrap">
          <StatTile
            title="Attended"
            value={attendanceQuery.isLoading ? '—' : attendanceQuery.data ?? 0}
            subtitle="check-ins in range"
            tone="green"
            href="/management/attendance"
          />
        </View>
      ) : null}
    </View>
  );
}

function PresetChip({
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
      className={`px-3 py-1.5 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <Text
        className={
          active ? 'text-primary text-sm' : 'text-gray-500 dark:text-gray-400 text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function RevenueRow({
  rows,
  loading,
}: {
  rows: { currency: string; gross_cents: number; charge_count: number }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <View className="flex-row gap-3 flex-wrap">
        <StatTile title="Revenue" value="—" subtitle="loading…" href="/management/plans" />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View className="flex-row gap-3 flex-wrap">
        <StatTile
          title="Revenue"
          value={formatCurrency(0, 'USD')}
          subtitle="no charges in range"
          href="/management/plans"
        />
      </View>
    );
  }
  return (
    <View className="flex-row gap-3 flex-wrap">
      {rows.map((r) => (
        <StatTile
          key={r.currency}
          title={rows.length > 1 ? `Revenue · ${r.currency.toUpperCase()}` : 'Revenue'}
          value={formatCurrency(r.gross_cents, r.currency)}
          subtitle={`${r.charge_count} ${r.charge_count === 1 ? 'charge' : 'charges'}`}
          href="/management/plans"
        />
      ))}
    </View>
  );
}

function InsightsRow({
  data,
  loading,
}: {
  data: {
    intros_new: number;
    conversions: number;
    expiring_soon: number;
  } | null;
  loading: boolean;
}) {
  const intros = loading ? '—' : data?.intros_new ?? 0;
  const conversions = loading ? '—' : data?.conversions ?? 0;
  const expiring = loading ? '—' : data?.expiring_soon ?? 0;
  return (
    <View className="flex-row gap-3 flex-wrap">
      <StatTile
        title="Intros"
        value={intros}
        subtitle="new in range"
        href="/management/insights"
      />
      <StatTile
        title="Conversion"
        value={conversions}
        subtitle="paying in range"
        href="/management/insights"
      />
      <StatTile
        title="Expiring soon"
        value={expiring}
        subtitle="≤ 7 days"
        href="/management/insights"
      />
    </View>
  );
}
