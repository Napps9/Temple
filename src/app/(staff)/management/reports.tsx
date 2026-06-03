import { useMutation } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type MemberRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null; phone: string | null } | null;
};

type MembershipRow = {
  id: string;
  profile_id: string;
  status: string;
  paid_period_end: string | null;
  created_at: string;
  membership_plans: { name: string } | null;
  profiles: { full_name: string | null } | null;
};

type AttendanceRow = {
  id: string;
  profile_id: string;
  attended_at: string | null;
  no_show: boolean;
  created_at: string;
  profiles: { full_name: string | null } | null;
  class_sessions: {
    starts_at: string;
    class_types: { name: string } | null;
  } | null;
};

export default function ReportsScreen() {
  const role = useRole();
  const { data: membership } = useGymMembership();
  const [error, setError] = useState<string | null>(null);

  const exportMembers = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          'profile_id, joined_at, is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles(full_name, phone)',
        )
        .eq('gym_id', membership.gymId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as MemberRow[];
      const csv = buildCsv<MemberRow>(rows, [
        { key: 'name', header: 'Name', format: (r) => r.profiles?.full_name ?? '' },
        { key: 'phone', header: 'Phone', format: (r) => r.profiles?.phone ?? '' },
        { key: 'joined_at', header: 'Joined', format: (r) => r.joined_at.slice(0, 10) },
        { key: 'is_active', header: 'Active', format: (r) => (r.is_active ? 'yes' : 'no') },
        { key: 'is_intro', header: 'Intro', format: (r) => (r.is_intro ? 'yes' : 'no') },
        { key: 'is_paying', header: 'Paying', format: (r) => (r.is_paying ? 'yes' : 'no') },
        {
          key: 'is_expiring_soon',
          header: 'Expiring soon',
          format: (r) => (r.is_expiring_soon ? 'yes' : 'no'),
        },
        { key: 'is_expired', header: 'Expired', format: (r) => (r.is_expired ? 'yes' : 'no') },
        {
          key: 'days_until_expiry',
          header: 'Days until expiry',
          format: (r) => (r.days_until_expiry === null ? '' : r.days_until_expiry),
        },
      ]);
      await downloadCsv(`members-${isoDay(new Date())}.csv`, csv);
    },
    onError: (e) => setError(errorMessage(e, 'Could not export members')),
    onSuccess: () => setError(null),
  });

  const exportMemberships = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, profile_id, status, paid_period_end, created_at, membership_plans(name), profiles(full_name)',
        )
        .eq('gym_id', membership.gymId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as MembershipRow[];
      const csv = buildCsv<MembershipRow>(rows, [
        { key: 'name', header: 'Member', format: (r) => r.profiles?.full_name ?? '' },
        { key: 'plan', header: 'Plan', format: (r) => r.membership_plans?.name ?? '' },
        { key: 'status', header: 'Status' },
        {
          key: 'paid_period_end',
          header: 'Paid through',
          format: (r) => (r.paid_period_end ? r.paid_period_end.slice(0, 10) : ''),
        },
        {
          key: 'created_at',
          header: 'Started',
          format: (r) => r.created_at.slice(0, 10),
        },
      ]);
      await downloadCsv(`memberships-${isoDay(new Date())}.csv`, csv);
    },
    onError: (e) => setError(errorMessage(e, 'Could not export memberships')),
    onSuccess: () => setError(null),
  });

  const exportAttendance = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, profile_id, attended_at, no_show, created_at, profiles(full_name), class_sessions(starts_at, class_types(name))',
        )
        .eq('gym_id', membership.gymId)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as AttendanceRow[];
      const csv = buildCsv<AttendanceRow>(rows, [
        { key: 'name', header: 'Member', format: (r) => r.profiles?.full_name ?? '' },
        {
          key: 'class',
          header: 'Class type',
          format: (r) => r.class_sessions?.class_types?.name ?? '',
        },
        {
          key: 'starts_at',
          header: 'Class start',
          format: (r) => r.class_sessions?.starts_at ?? '',
        },
        {
          key: 'attended_at',
          header: 'Attended at',
          format: (r) => r.attended_at ?? '',
        },
        {
          key: 'no_show',
          header: 'No-show',
          format: (r) => (r.no_show ? 'yes' : 'no'),
        },
        {
          key: 'created_at',
          header: 'Booked at',
          format: (r) => r.created_at,
        },
      ]);
      await downloadCsv(`attendance-${isoDay(new Date())}.csv`, csv);
    },
    onError: (e) => setError(errorMessage(e, 'Could not export attendance')),
    onSuccess: () => setError(null),
  });

  if (role && !can(role, 'can_export_members')) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Reports
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            One-click CSV exports. Files include a UTF-8 BOM so Excel and
            Sheets open them with the right encoding.
          </Text>
        </View>

        <View className="gap-3">
          <ExportCard
            title="Members"
            description="One row per member: contact details, lifecycle flags, days to expiry. Backed by the same view that powers Insights, so the numbers reconcile."
            onPress={() => exportMembers.mutate()}
            loading={exportMembers.isPending}
          />
          <ExportCard
            title="Memberships"
            description="One row per plan subscription: member, plan, status, paid-through date."
            onPress={() => exportMemberships.mutate()}
            loading={exportMemberships.isPending}
          />
          <ExportCard
            title="Attendance"
            description="One row per booking: member, class type, check-in state. Last 5,000 bookings."
            onPress={() => exportAttendance.mutate()}
            loading={exportAttendance.isPending}
          />
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ExportCard({
  title,
  description,
  onPress,
  loading,
}: {
  title: string;
  description: string;
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">{title}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">{description}</Text>
      </View>
      <Button onPress={onPress} loading={loading}>
        Download CSV
      </Button>
    </View>
  );
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
