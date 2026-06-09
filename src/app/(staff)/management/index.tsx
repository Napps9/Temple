import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BillingNotLiveTile } from '@/components/BillingNotLiveTile';
import { Button } from '@/components/Button';
import {
  DATE_RE,
  DateRangeCta,
  PRESET_LABELS,
  type Preset,
  isoDate,
  presetRange,
} from '@/components/DateRangeCta';
import { Input } from '@/components/Input';
import { MembersList } from '@/components/MembersList';
import { Screen } from '@/components/Screen';
import { StatTile, type Delta, type DeltaDirection } from '@/components/StatTile';
import {
  bucketByClassType,
  type AttendanceBooking,
  type AttendanceSession,
} from '@/lib/attendance';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { useExportMembersCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { BrandingPanel } from './branding';
import { ClassTypesPanel } from './class-types';
import { LeaderboardsPanel } from './leaderboards';
import { MessagingPanel } from './messaging';
import { PlansPanel } from './plans';

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

type Category = 'insights' | 'members' | 'team' | 'plans' | 'settings';

type IconName = ComponentProps<typeof Ionicons>['name'];

const CATEGORY_LABELS: Record<Category, string> = {
  insights: 'Insights',
  members: 'Members',
  team: 'Team',
  plans: 'Plans',
  settings: 'Settings',
};

const CATEGORY_ICONS: Record<Category, IconName> = {
  insights: 'bar-chart-outline',
  members: 'people-outline',
  team: 'briefcase-outline',
  plans: 'pricetags-outline',
  settings: 'settings-outline',
};

const CATEGORY_ORDER: Category[] = [
  'insights',
  'members',
  'team',
  'plans',
  'settings',
];

type Card = {
  category: Category;
  title: string;
  description: string;
  href: LinkHref;
  visible: boolean;
};

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
  const canSetCoachPay = useCan('can_set_coach_pay');
  const canConfigureLeaderboards = useCan('can_configure_leaderboards');

  const cards: Card[] = [
    {
      category: 'insights',
      title: 'Insights',
      description: 'Intros, expiring members, conversion vs targets.',
      href: '/management/insights',
      visible: !!canSeeInsights,
    },
    {
      category: 'insights',
      title: 'Attendance',
      description: 'Trends from check-ins on class bookings.',
      href: '/management/attendance',
      visible: !!canViewAttendance,
    },
    {
      category: 'team',
      title: 'Team',
      description: 'Invite owners, coaches, staff and members.',
      href: '/management/team',
      visible: !!canManageStaff,
    },
    {
      category: 'team',
      title: 'Coach earnings',
      description: 'Set per-class-type rates and review what coaches earned.',
      href: '/management/coach-earnings',
      visible: !!canSetCoachPay,
    },
    {
      category: 'team',
      title: 'SOPs',
      description: 'How we do things here — for the whole team.',
      href: '/management/sops',
      visible: !!canViewSops,
    },
    {
      category: 'team',
      title: 'Tasks',
      description: 'Day-to-day staff work, assigned and tracked.',
      href: '/management/tasks',
      visible: !!canManageTasks || role === 'staff',
    },
    {
      category: 'team',
      title: 'Cover',
      description: 'Hand a class to another coach; first-claim wins.',
      href: '/management/cover',
      visible: !!canRequestCover || !!canClaimCover,
    },
    {
      category: 'settings',
      title: 'Branding',
      description: 'Logo, colours, gym name, public join link.',
      href: '/management/branding',
      visible: !!canManageStaff,
    },
    {
      category: 'settings',
      title: 'Leaderboards',
      description: 'Turn class and strength comparisons on or off.',
      href: '/management/leaderboards',
      visible: !!canConfigureLeaderboards,
    },
    {
      category: 'settings',
      title: 'Messaging',
      description: 'Decide who can DM whom inside the gym.',
      href: '/management/messaging',
      visible: !!canManageStaff,
    },
    {
      category: 'settings',
      title: 'Class types',
      description: 'Name and colour the kinds of class you run.',
      href: '/management/class-types',
      visible: !!canEditClasses,
    },
    {
      category: 'members',
      title: 'Members',
      description: 'View members by cohort, see and edit their tags.',
      href: '/management/members',
      visible: !!canManageTags,
    },
    {
      category: 'members',
      title: 'Tag rules',
      description: 'Auto-tag members based on cohort state.',
      href: '/management/tags',
      visible: !!canManageTags,
    },
    {
      category: 'plans',
      title: 'Plans',
      description: 'Define your membership plans, prices, and credit packs.',
      href: '/management/plans',
      visible: !!canManagePlans,
    },
  ];

  const availableCategories = CATEGORY_ORDER.filter((c) =>
    cards.some((card) => card.category === c && card.visible),
  );
  const [active, setActive] = useState<Category>(
    availableCategories[0] ?? 'insights',
  );
  const activeCategory = availableCategories.includes(active)
    ? active
    : availableCategories[0] ?? 'insights';
  const visibleCards = cards.filter(
    (c) => c.visible && c.category === activeCategory,
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <KeyStats />
        {availableCategories.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2">
            {availableCategories.map((c) => {
              const selected = c === activeCategory;
              return (
                <Pressable
                  key={c}
                  onPress={() => setActive(c)}
                  className={`px-4 py-2 rounded-full flex-row items-center gap-1.5 ${
                    selected ? 'bg-primary' : 'bg-gray-100 dark:bg-gray-800'
                  }`}>
                  <Ionicons
                    name={CATEGORY_ICONS[c]}
                    size={16}
                    color={selected ? '#FFFFFF' : '#6B7280'}
                  />
                  <Text
                    className={`text-sm font-medium ${
                      selected
                        ? 'text-white'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {activeCategory === 'insights' ? (
          <InsightsTab />
        ) : activeCategory === 'members' ? (
          <MembersTab />
        ) : activeCategory === 'plans' ? (
          <PlansPanel />
        ) : activeCategory === 'settings' ? (
          <SettingsTab />
        ) : (
          visibleCards.map((c) => (
            <ManagementCard
              key={c.title}
              title={c.title}
              description={c.description}
              href={c.href}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function SettingsTab() {
  const canManageStaff = useCan('can_manage_staff') ?? false;
  const canConfigureLeaderboards = useCan('can_configure_leaderboards') ?? false;
  const canEditClasses = useCan('can_edit_classes') ?? false;

  return (
    <View className="gap-6">
      {canManageStaff ? (
        <View className="gap-3">
          <SectionHeader title="Branding" icon="color-palette-outline" />
          <BrandingPanel />
        </View>
      ) : null}
      {canConfigureLeaderboards ? (
        <View className="gap-3">
          <SectionHeader title="Leaderboards" icon="trophy-outline" />
          <LeaderboardsPanel />
        </View>
      ) : null}
      {canManageStaff ? (
        <View className="gap-3">
          <SectionHeader title="Messaging" icon="chatbubbles-outline" />
          <MessagingPanel />
        </View>
      ) : null}
      {canEditClasses ? (
        <View className="gap-3">
          <SectionHeader title="Class types" icon="calendar-outline" />
          <ClassTypesPanel />
        </View>
      ) : null}
    </View>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: IconName }) {
  return (
    <View className="flex-row items-center gap-2 mt-2">
      <Ionicons name={icon} size={18} color="#6B7280" />
      <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
        {title}
      </Text>
    </View>
  );
}

// ============================================================================
// Key stats — at-a-glance KPIs on the manage page, with a shared date filter.
// ============================================================================



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

type RevenueRow = { currency: string; gross_cents: number; charge_count: number };

// Build the "previous period" — same length as the current range,
// immediately preceding it. Inclusive on both ends.
//
// e.g. current = (2026-06-01, 2026-06-07) — 7 days
//      mirror  = (2026-05-25, 2026-05-31) — 7 days, ending the day before current starts
function mirrorRange(range: { start: string; end: string }): { start: string; end: string } {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const mirrorEnd = new Date(start.getTime() - 86400000);
  const mirrorStart = new Date(mirrorEnd.getTime() - (days - 1) * 86400000);
  return { start: isoDate(mirrorStart), end: isoDate(mirrorEnd) };
}

// The day before a given period — used as the as-of date for the
// mirror member count, so it's strictly before the current period starts.
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return isoDate(new Date(d.getTime() - 86400000));
}

// Pick the dominant currency by charge_count, otherwise USD. Multi-
// currency gyms are rare enough that one tile per gym is the right
// trade — if a gym needs more, the Plans / Reports screens still show
// per-currency detail.
function pickPrimaryCurrency(rows: RevenueRow[]): RevenueRow {
  if (rows.length === 0) return { currency: 'USD', gross_cents: 0, charge_count: 0 };
  return [...rows].sort((a, b) => b.charge_count - a.charge_count)[0]!;
}

function pctDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { direction: 'flat', label: 'no change' };
  if (previous === 0) return { direction: 'up', label: 'new' };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < 0.001) return { direction: 'flat', label: '0%' };
  const pct = ratio * 100;
  const direction: DeltaDirection = pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : '';
  return { direction, label: `${sign}${pct.toFixed(1)}%` };
}

function ppDelta(current: number, previous: number): Delta {
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return { direction: 'flat', label: '0 pp' };
  const direction: DeltaDirection = diff > 0 ? 'up' : 'down';
  const sign = diff > 0 ? '+' : '';
  return { direction, label: `${sign}${diff.toFixed(1)} pp` };
}

function KeyStats() {
  const { data: membership } = useGymMembership();

  const showRevenue = useCan('can_see_money') ?? false;
  const showMembers = useCan('can_view_attendance') ?? false;
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

  const prev = useMemo(
    () => (rangeValid ? mirrorRange(range) : null),
    [range.start, range.end, rangeValid],
  );

  const gymId = membership?.gymId;

  const revenueCurrent = useQuery({
    queryKey: ['manage-revenue', gymId, range.start, range.end],
    enabled: !!gymId && showRevenue && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_revenue_summary', {
        p_gym_id: gymId!,
        p_period_start: range.start,
        p_period_end: range.end,
      });
      if (error) throw error;
      return (data ?? []) as RevenueRow[];
    },
  });
  const revenuePrev = useQuery({
    queryKey: ['manage-revenue', gymId, prev?.start, prev?.end],
    enabled: !!gymId && showRevenue && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_revenue_summary', {
        p_gym_id: gymId!,
        p_period_start: prev!.start,
        p_period_end: prev!.end,
      });
      if (error) throw error;
      return (data ?? []) as RevenueRow[];
    },
  });

  const membersCurrent = useQuery({
    queryKey: ['manage-members-asof', gymId, range.end],
    enabled: !!gymId && showMembers && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_members_as_of', {
        p_gym_id: gymId!,
        p_as_of: range.end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
  const membersPrev = useQuery({
    queryKey: ['manage-members-asof', gymId, prev ? dayBefore(range.start) : null],
    enabled: !!gymId && showMembers && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_members_as_of', {
        p_gym_id: gymId!,
        p_as_of: dayBefore(range.start),
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const attendeesCurrent = useQuery({
    queryKey: ['manage-attendees', gymId, range.start, range.end],
    enabled: !!gymId && showAttendance && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_attendance_attendees', {
        p_gym_id: gymId!,
        p_period_start: range.start,
        p_period_end: range.end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
  const attendeesPrev = useQuery({
    queryKey: ['manage-attendees', gymId, prev?.start, prev?.end],
    enabled: !!gymId && showAttendance && rangeValid && !!prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_attendance_attendees', {
        p_gym_id: gymId!,
        p_period_start: prev!.start,
        p_period_end: prev!.end,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  if (!showRevenue && !showMembers && !showAttendance) return null;

  const queryError =
    revenueCurrent.error ??
    revenuePrev.error ??
    membersCurrent.error ??
    membersPrev.error ??
    attendeesCurrent.error ??
    attendeesPrev.error;

  // Derive each tile's value + delta.
  const revenueNow = pickPrimaryCurrency(revenueCurrent.data ?? []);
  const revenueThen = pickPrimaryCurrency(revenuePrev.data ?? []);
  const revenueLoading = revenueCurrent.isLoading || revenuePrev.isLoading;
  const revenueDelta = revenueLoading
    ? undefined
    : pctDelta(revenueNow.gross_cents, revenueThen.gross_cents);

  const membersNow = membersCurrent.data ?? 0;
  const membersThen = membersPrev.data ?? 0;
  const membersLoading = membersCurrent.isLoading || membersPrev.isLoading;
  const membersDelta = membersLoading ? undefined : pctDelta(membersNow, membersThen);

  // Attendance rate = distinct attendees / total members at period end * 100.
  // If we have no members, rate is 0 (avoid divide-by-zero); same for previous.
  const attendanceLoading =
    attendeesCurrent.isLoading ||
    attendeesPrev.isLoading ||
    membersCurrent.isLoading ||
    membersPrev.isLoading;
  const ratePctNow = membersNow > 0 ? ((attendeesCurrent.data ?? 0) / membersNow) * 100 : 0;
  const ratePctThen = membersThen > 0 ? ((attendeesPrev.data ?? 0) / membersThen) * 100 : 0;
  const attendanceDelta = attendanceLoading ? undefined : ppDelta(ratePctNow, ratePctThen);

  return (
    <View className="gap-3">
      <DateRangeCta
        preset={preset}
        range={range}
        onChange={(next) => {
          setPreset(next.preset);
          if (next.preset === 'custom') {
            setCustomStart(next.start);
            setCustomEnd(next.end);
          }
        }}
        customStart={customStart}
        customEnd={customEnd}
      />

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

      <View className="flex-row gap-3 flex-wrap">
        {showRevenue ? (
          <StatTile
            title="Revenue"
            value={
              revenueLoading
                ? '—'
                : formatCurrency(revenueNow.gross_cents, revenueNow.currency)
            }
            subtitle="vs previous period"
            delta={revenueDelta}
            href="/management/plans"
          />
        ) : null}
        {showMembers ? (
          <StatTile
            title="Members"
            value={membersLoading ? '—' : membersNow}
            subtitle="vs previous period"
            delta={membersDelta}
            href="/management/members"
          />
        ) : null}
        {showAttendance ? (
          <StatTile
            title="Attendance"
            value={attendanceLoading ? '—' : `${ratePctNow.toFixed(0)}%`}
            subtitle="of members checked in"
            delta={attendanceDelta}
            href="/management/attendance"
          />
        ) : null}
      </View>
    </View>
  );
}

// ============================================================================
// Insights tab — lifecycle metrics on display + attendance summary + CTAs.
// ============================================================================

type InsightsSummary = {
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
type TargetPeriod = 'month' | 'quarter';
type TargetRow = {
  metric: TargetMetric;
  period: TargetPeriod;
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

const TARGET_PERIODS: TargetPeriod[] = ['month', 'quarter'];

function InsightsTab() {
  const { data: membership } = useGymMembership();
  const canSeeInsights = useCan('can_see_insights') ?? false;
  const canSetTargets = useCan('can_set_targets') ?? false;

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
    enabled: !!membership?.gymId && canSeeInsights,
    queryFn: async (): Promise<InsightsSummary> => {
      const { data, error } = await supabase.rpc('compute_insight_summary', {
        p_gym_id: membership!.gymId,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      const rows = data as unknown as InsightsSummary[];
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

  if (!canSeeInsights) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        You don't have permission to see insights.
      </Text>
    );
  }

  return (
    <View className="gap-4">
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
            <StatTile
              title="Intros"
              value={summary.data.intros_new}
              subtitle="new this period"
            />
            <StatTile
              title="Expiring soon"
              value={summary.data.expiring_soon}
              subtitle="≤ 7 days"
            />
            <StatTile
              title="Expired"
              value={summary.data.expired}
              subtitle="no live access"
            />
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

      {canSetTargets ? <TargetsLauncher /> : null}
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

function TargetsLauncher() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <View className="mt-2">
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
        <Button variant="ghost" onPress={() => setOpen(false)}>
          Hide targets
        </Button>
      </View>
    </View>
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
        period: TargetPeriod;
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

// ============================================================================
// Members tab — attendance stats first, export CTA, then the member list.
// Tag rules sit at the bottom as a CTA.
// ============================================================================

function MembersTab() {
  const { data: membership } = useGymMembership();
  const canViewAttendance = useCan('can_view_attendance') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const canManageTags = useCan('can_manage_tags') ?? false;
  const exportMembers = useExportMembersCsv();

  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);
  const { start, end } = range;
  const rangeValid =
    DATE_RE.test(start) && DATE_RE.test(end) && start <= end;

  const sessionsQuery = useQuery({
    queryKey: ['attendance-sessions', membership?.gymId, start, end],
    enabled: !!membership?.gymId && canViewAttendance && rangeValid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, class_type_id, starts_at')
        .gte('starts_at', `${start}T00:00:00Z`)
        .lte('starts_at', `${end}T23:59:59Z`);
      if (error) throw error;
      return (data ?? []) as AttendanceSession[];
    },
  });

  const sessionIds = useMemo(
    () => (sessionsQuery.data ?? []).map((s) => s.id),
    [sessionsQuery.data],
  );

  const bookingsQuery = useQuery({
    queryKey: ['attendance-bookings', membership?.gymId, sessionIds.join(',')],
    enabled: !!membership?.gymId && canViewAttendance && sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id, attended_at, no_show')
        .in('class_session_id', sessionIds);
      if (error) throw error;
      return (data ?? []) as AttendanceBooking[];
    },
  });

  const totals = useMemo(() => {
    const typeBuckets = bucketByClassType(
      bookingsQuery.data ?? [],
      sessionsQuery.data ?? [],
    );
    return typeBuckets.reduce(
      (acc, b) => ({
        attended: acc.attended + b.attended,
        no_show: acc.no_show + b.no_show,
        unmarked: acc.unmarked + b.unmarked,
      }),
      { attended: 0, no_show: 0, unmarked: 0 },
    );
  }, [bookingsQuery.data, sessionsQuery.data]);

  return (
    <View className="gap-4">
      {canViewAttendance ? (
        <View className="gap-3">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Attendance
          </Text>
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
          <View className="flex-row gap-3 flex-wrap">
            <StatTile
              title="Attended"
              value={totals.attended}
              tone="green"
              minWidth={120}
            />
            <StatTile
              title="No-show"
              value={totals.no_show}
              tone="red"
              minWidth={120}
            />
            <StatTile
              title="Unmarked"
              value={totals.unmarked}
              tone="muted"
              minWidth={120}
            />
          </View>
        </View>
      ) : null}

      {canExport ? (
        <View className="gap-2">
          <Button
            variant="secondary"
            onPress={() => exportMembers.mutate()}
            loading={exportMembers.isPending}>
            Export members CSV
          </Button>
          {exportMembers.error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {exportErrorMessage(exportMembers.error, 'members')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {canManageTags ? (
        <>
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Members
          </Text>
          <MembersList />
          <ManagementCard
            title="Tag rules"
            description="Auto-tag members based on cohort state."
            href="/management/tags"
          />
        </>
      ) : null}
    </View>
  );
}

