import { useMutation } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import { buildCsv, downloadCsv } from './csv';
import { errorMessage } from './errors';
import { supabase } from './supabase';

type MemberRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null } | null;
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

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function useExportMembersCsv() {
  const { data: membership } = useGymMembership();
  return useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          'profile_id, joined_at, is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles!profile_id(full_name)',
        )
        .eq('gym_id', membership.gymId);
      if (error) throw error;

      // Phone comes from the capability-gated RPC, not an embedded join.
      // It used to ride out on profiles under can_export_members alone —
      // a permission about exporting, not about seeing someone's number.
      // A caller without can_see_full_pii gets an empty column, and one
      // without any contact capability gets an error we swallow, because a
      // member export minus a phone column is still a useful export.
      const phones = new Map<string, string>();
      const { data: contacts } = await supabase.rpc('gym_member_contacts', {
        p_gym_id: membership.gymId,
      });
      for (const c of (contacts ?? []) as {
        profile_id: string;
        phone: string | null;
      }[]) {
        if (c.phone) phones.set(c.profile_id, c.phone);
      }

      const rows = (data ?? []) as unknown as MemberRow[];
      const csv = buildCsv<MemberRow>(rows, [
        { key: 'name', header: 'Name', format: (r) => r.profiles?.full_name ?? '' },
        {
          key: 'phone',
          header: 'Phone',
          format: (r) => phones.get(r.profile_id) ?? '',
        },
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
  });
}

export function useExportMembershipsCsv() {
  const { data: membership } = useGymMembership();
  return useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'id, profile_id, status, paid_period_end, created_at, membership_plans!plan_id(name), profiles!profile_id(full_name)',
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
  });
}

export function useExportAttendanceCsv() {
  const { data: membership } = useGymMembership();
  return useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, profile_id, attended_at, no_show, created_at, profiles!profile_id(full_name), class_sessions(starts_at, class_types(name))',
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
  });
}

export function exportErrorMessage(error: unknown, kind: 'members' | 'memberships' | 'attendance'): string {
  return errorMessage(error, `Could not export ${kind}`);
}
