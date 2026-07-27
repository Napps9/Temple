import { useQuery } from '@tanstack/react-query';

import { useGymMembership, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { dueCheckIns, useMyInjuries } from '@/lib/useInjuries';
import { localDayKey } from '@/lib/workout-streak';

// In-app "what needs you" surfacing, so a nav badge can total it and the
// inbox can show it. Most sources here read the same data the relevant
// screens use; cover is the exception — cover_notifications (0165) is a
// real queue table, because those events also go out by email and every
// attempt has to be logged.

export type InboxUnread = {
  dm_unread: number;
  announcement_unread: number;
  class_broadcast_unread: number;
  class_change_unread: number;
  payment_unread: number;
};

// Mirrors the inbox screen's query (same key → shared cache).
export function useInboxUnread() {
  const session = useSession();
  return useQuery({
    queryKey: ['inbox-unread-summary', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<InboxUnread> => {
      const { data, error } = await supabase.rpc('inbox_unread_summary');
      if (error) throw error;
      const row = (data ?? [])[0] as InboxUnread | undefined;
      return (
        row ?? {
          dm_unread: 0,
          announcement_unread: 0,
          class_broadcast_unread: 0,
          class_change_unread: 0,
          payment_unread: 0,
        }
      );
    },
  });
}

export type LogNudgeItem = {
  sessionId: string;
  startsAt: string;
  className: string;
  day: string;
};

const LOG_NUDGE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Classes the member was marked present for in the last few days that
// they haven't logged a workout against. Day-grained so any log on that
// day clears it (we never double-nag), and one item per day.
export function useLogNudge() {
  const session = useSession();
  return useQuery({
    queryKey: ['log-nudge', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<LogNudgeItem[]> => {
      const sinceIso = new Date(Date.now() - LOG_NUDGE_WINDOW_MS).toISOString();
      const nowIso = new Date().toISOString();
      const [attended, logged] = await Promise.all([
        supabase
          .from('class_bookings')
          .select(
            'class_session_id, attended_at, class_sessions!inner(starts_at, class_types(name))',
          )
          .eq('profile_id', session!.user.id)
          .not('attended_at', 'is', null)
          .gte('class_sessions.starts_at', sinceIso)
          .lte('class_sessions.starts_at', nowIso),
        supabase
          .from('tracked_workouts')
          .select('performed_at')
          .eq('profile_id', session!.user.id)
          .gte('performed_at', sinceIso),
      ]);
      if (attended.error) throw attended.error;
      if (logged.error) throw logged.error;

      const loggedDays = new Set(
        (logged.data ?? []).map((r) =>
          localDayKey(new Date((r as { performed_at: string }).performed_at)),
        ),
      );

      const rows = (attended.data ?? []) as unknown as {
        class_session_id: string;
        class_sessions: {
          starts_at: string;
          class_types: { name: string } | null;
        } | null;
      }[];

      const seen = new Set<string>();
      return rows
        .map((r) => ({
          sessionId: r.class_session_id,
          startsAt: r.class_sessions?.starts_at ?? '',
          className: r.class_sessions?.class_types?.name ?? 'your class',
          day: r.class_sessions
            ? localDayKey(new Date(r.class_sessions.starts_at))
            : '',
        }))
        .filter((i) => i.startsAt && !loggedDays.has(i.day))
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
        .filter((i) => (seen.has(i.day) ? false : (seen.add(i.day), true)));
    },
  });
}

// Unread in-app lead notifications for the signed-in coach — a lead
// assigned to them that they haven't opened yet. Only the assignee sees
// their own count (the RPC filters on auth.uid()), so it's cheap and safe
// to include for every staff member.
export function useUnreadLeadNotifications() {
  const { data: membership } = useGymMembership();
  const canAssignPlan = useCan('can_assign_plan') ?? false;
  return useQuery({
    queryKey: ['unread-lead-notifications', membership?.gymId],
    enabled: !!membership?.gymId && canAssignPlan,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('count_unread_lead_notifications', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

// Open (unacknowledged) PAR-Q/injury alerts — the Alerts tab's own
// count, surfaced here so it also contributes to the nav badges
// instead of only being visible once you open the Inbox.
export function useOpenStaffAlertsCount() {
  const { data: membership } = useGymMembership();
  const canSeeHealthFlag = useCan('can_see_health_flag') ?? false;
  return useQuery({
    queryKey: ['open-staff-alerts-count', membership?.gymId],
    enabled: !!membership?.gymId && canSeeHealthFlag,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('count_open_staff_alerts', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

// Unread in-app cover notifications for the signed-in coach — cover they
// could claim, or one of their own classes being picked up. The RPC
// filters on auth.uid(), so it only ever counts your own.
export function useUnreadCoverNotifications() {
  const { data: membership } = useGymMembership();
  const canRequestCover = useCan('can_request_cover') ?? false;
  const canClaimCover = useCan('can_claim_cover') ?? false;
  return useQuery({
    queryKey: ['unread-cover-notifications', membership?.gymId],
    enabled: !!membership?.gymId && (canRequestCover || canClaimCover),
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc(
        'count_unread_cover_notifications',
        { p_gym_id: membership!.gymId },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

// Total count behind the nav badges: unread messages + injury
// check-ins due + classes waiting to be logged + open staff alerts.
export function useNotificationCount(): number {
  const unread = useInboxUnread();
  const injuries = useMyInjuries();
  const logNudge = useLogNudge();
  const openAlerts = useOpenStaffAlertsCount();
  const leadNotifications = useUnreadLeadNotifications();
  const coverNotifications = useUnreadCoverNotifications();
  const unreadTotal =
    (unread.data?.dm_unread ?? 0) +
    (unread.data?.announcement_unread ?? 0) +
    (unread.data?.class_broadcast_unread ?? 0) +
    (unread.data?.class_change_unread ?? 0) +
    (unread.data?.payment_unread ?? 0);
  return (
    unreadTotal +
    dueCheckIns(injuries.data).length +
    (logNudge.data?.length ?? 0) +
    (openAlerts.data ?? 0) +
    (leadNotifications.data ?? 0) +
    (coverNotifications.data ?? 0)
  );
}
