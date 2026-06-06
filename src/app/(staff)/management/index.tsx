import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { DatePicker } from '@/components/DatePicker';
import { Screen } from '@/components/Screen';
import { StatTile, type Delta, type DeltaDirection } from '@/components/StatTile';
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

// Single CTA + modal that owns the date-range picker. Collapses the
// six preset chips + custom inputs into one tappable label that
// expands on demand.
function DateRangeCta({
  preset,
  range,
  customStart,
  customEnd,
  onChange,
}: {
  preset: Preset;
  range: { start: string; end: string };
  customStart: string;
  customEnd: string;
  onChange: (next:
    | { preset: Exclude<Preset, 'custom'> }
    | { preset: 'custom'; start: string; end: string }
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  // Local working state while the modal is open — only committed on
  // Apply (custom) or on preset tap (presets). Keeps the dashboard
  // queries from re-firing on every keystroke in the date fields.
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [showCustom, setShowCustom] = useState(preset === 'custom');

  function openModal() {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setShowCustom(preset === 'custom');
    setOpen(true);
  }

  const label =
    preset === 'custom'
      ? `${fmtDdmm(range.start)} – ${fmtDdmm(range.end)}`
      : PRESET_LABELS[preset];

  return (
    <View>
      <Pressable
        onPress={openModal}
        className="flex-row items-center justify-between bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2.5 active:bg-gray-50 dark:active:bg-gray-800">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">{label}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">Change</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 bg-black/40 items-center justify-center px-6">
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
              Select period
            </Text>

            <View className="gap-1">
              {(Object.keys(PRESET_LABELS) as Exclude<Preset, 'custom'>[]).map((p) => (
                <PresetOption
                  key={p}
                  label={PRESET_LABELS[p]}
                  active={preset === p && !showCustom}
                  onPress={() => {
                    onChange({ preset: p });
                    setOpen(false);
                  }}
                />
              ))}
              <PresetOption
                label="Custom range"
                active={showCustom}
                onPress={() => setShowCustom(true)}
              />
            </View>

            {showCustom ? (
              <View className="gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <DatePicker
                      label="From"
                      value={draftStart}
                      onChange={setDraftStart}
                    />
                  </View>
                  <View className="flex-1">
                    <DatePicker
                      label="To"
                      value={draftEnd}
                      onChange={setDraftEnd}
                    />
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    onChange({
                      preset: 'custom',
                      start: draftStart,
                      end: draftEnd,
                    });
                    setOpen(false);
                  }}
                  className="bg-primary rounded-lg px-4 py-3 items-center active:bg-primary-dark">
                  <Text className="text-white font-semibold">Apply custom range</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function PresetOption({
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
      className={`flex-row items-center justify-between px-3 py-3 rounded-lg ${
        active ? 'bg-primary/10' : 'active:bg-gray-50 dark:active:bg-gray-800'
      }`}>
      <Text
        className={
          active
            ? 'text-primary font-medium'
            : 'text-gray-900 dark:text-gray-50'
        }>
        {label}
      </Text>
      {active ? <Text className="text-primary">✓</Text> : null}
    </Pressable>
  );
}

// DD/MM for the CTA label on custom ranges. Year omitted on purpose
// — the CTA is short and the explicit range is one tap away in the
// modal if the operator needs to verify.
function fmtDdmm(iso: string): string {
  if (!DATE_RE.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
