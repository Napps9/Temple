import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, View } from 'react-native';
import { EmptyState } from './EmptyState';

import { SoftLine } from '@/components/TimelineLines';
import { supabase } from '@/lib/supabase';
import {
  composeFutureDay,
  type FutureLine,
  type FutureLineKind,
} from '@/lib/future-day';
import { dayStart, nextDayStart, QUIET_FUTURE_DAY } from '@/lib/timeline-day';
import { useCan } from '@/lib/useCan';

// A future day of the Timeline: what is already on the books. Every
// read here rides an existing RLS policy — classes and closures are
// member-readable, scheduled sends sit behind can_manage_comms and
// renewals behind can_assign_plan, so the slices simply don't run for
// somebody the policy would refuse; their day is honestly smaller.
// Cover rows are RLS-filtered per row (user_can_cover), so for a
// non-cover viewer the embed comes back empty and no class reads as
// uncovered — same degradation, no error.

const FUTURE_ICON: Record<
  FutureLineKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  closure: 'moon-outline',
  class: 'barbell-outline',
  campaign: 'paper-plane-outline',
  renewal: 'refresh-outline',
  task: 'checkbox-outline',
};

type SessionRow = {
  id: string;
  name: string | null;
  starts_at: string;
  capacity: number | null;
  class_types: { name: string; archived_at: string | null } | null;
  cover_request_sessions: { claimed_by: string | null }[];
};

export function TimelineFutureDay({
  gymId,
  dayKey,
}: {
  gymId: string | undefined;
  dayKey: string;
}) {
  const canComms = useCan('can_manage_comms') ?? false;
  const canPlans = useCan('can_assign_plan') ?? false;
  const fromIso = dayStart(dayKey).toISOString();
  const toIso = nextDayStart(dayKey).toISOString();

  const sessions = useQuery({
    queryKey: ['future-day-classes', gymId, dayKey],
    enabled: !!gymId,
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, capacity, class_types(name, archived_at), cover_request_sessions(claimed_by)',
        )
        .eq('gym_id', gymId!)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at');
      if (error) throw error;
      const rows = (data ?? []) as unknown as SessionRow[];
      return rows.filter((s) => !s.class_types?.archived_at);
    },
  });

  const sessionIds = (sessions.data ?? []).map((s) => s.id);
  const bookings = useQuery({
    queryKey: ['future-day-bookings', gymId, dayKey, sessionIds.length],
    enabled: !!gymId && sessionIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('class_session_id')
        .in('class_session_id', sessionIds);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as { class_session_id: string }[]) {
        counts.set(row.class_session_id, (counts.get(row.class_session_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const closures = useQuery({
    queryKey: ['future-day-closures', gymId, dayKey],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_closures')
        .select('id, starts_on, ends_on')
        .eq('gym_id', gymId!)
        .is('lifted_at', null)
        .lte('starts_on', dayKey)
        .gte('ends_on', dayKey);
      if (error) throw error;
      return (data ?? []) as { id: string; starts_on: string; ends_on: string }[];
    },
  });

  const campaigns = useQuery({
    queryKey: ['future-day-campaigns', gymId, dayKey],
    enabled: !!gymId && canComms,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('id, title, subject, scheduled_for')
        .eq('gym_id', gymId!)
        .eq('status', 'scheduled')
        .gte('scheduled_for', fromIso)
        .lt('scheduled_for', toIso);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        title: string | null;
        subject: string | null;
        scheduled_for: string;
      }[];
    },
  });

  const renewals = useQuery({
    queryKey: ['future-day-renewals', gymId, dayKey],
    enabled: !!gymId && canPlans,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select(
          'profile_id, paid_period_end, membership_plans(name), member:profiles!profile_id(full_name)',
        )
        .eq('gym_id', gymId!)
        .eq('status', 'active')
        .gte('paid_period_end', fromIso)
        .lt('paid_period_end', toIso);
      if (error) throw error;
      return (data ?? []) as unknown as {
        profile_id: string;
        membership_plans: { name: string } | null;
        member: { full_name: string | null } | null;
      }[];
    },
  });

  const tasks = useQuery({
    queryKey: ['future-day-tasks', gymId, dayKey],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_tasks')
        .select('id, title, assignee:profiles!assigned_to(full_name)')
        .eq('gym_id', gymId!)
        .eq('status', 'open')
        .eq('due_date', dayKey);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        title: string;
        assignee: { full_name: string | null } | null;
      }[];
    },
  });

  const loading = sessions.isLoading || closures.isLoading;
  const lines: FutureLine[] = composeFutureDay({
    closures: (closures.data ?? []).map((c) => ({
      id: c.id,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
    })),
    classes: (sessions.data ?? []).map((s) => ({
      id: s.id,
      name: s.name?.trim() || s.class_types?.name || 'A class',
      startsAt: s.starts_at,
      capacity: s.capacity,
      booked: bookings.data?.get(s.id) ?? 0,
      uncovered: s.cover_request_sessions.some((o) => o.claimed_by === null),
    })),
    campaigns: (campaigns.data ?? []).map((c) => ({
      id: c.id,
      title: c.title?.trim() || c.subject || 'A campaign',
      scheduledFor: c.scheduled_for,
    })),
    renewals: (renewals.data ?? []).map((r) => ({
      profileId: r.profile_id,
      name: r.member?.full_name?.trim().split(/\s+/)[0] || 'A member',
      planName: r.membership_plans?.name ?? 'membership',
    })),
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      assigneeName: t.assignee?.full_name?.trim().split(/\s+/)[0] ?? null,
    })),
  });

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"
      refreshControl={
        <RefreshControl
          refreshing={sessions.isRefetching}
          onRefresh={() => {
            void sessions.refetch();
            void bookings.refetch();
            void closures.refetch();
            if (canComms) void campaigns.refetch();
            if (canPlans) void renewals.refetch();
            void tasks.refetch();
          }}
        />
      }>
      {loading ? (
        <View className="px-4 py-4">
          <EmptyState kind="loading" rows={3} />
        </View>
      ) : lines.length === 0 ? (
        <View className="px-4 py-4">
          <EmptyState
            icon="calendar-clear-outline"
            title={QUIET_FUTURE_DAY.title}
            description={QUIET_FUTURE_DAY.body}
          />
        </View>
      ) : (
        lines.map((l) => (
          <SoftLine
            key={l.key}
            text={l.text}
            tone={l.tone}
            lead={l.lead}
            icon={FUTURE_ICON[l.kind]}
            at={l.at}
            href={l.href}
          />
        ))
      )}
    </ScrollView>
  );
}
