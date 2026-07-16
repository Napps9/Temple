import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CancelClassDialog } from '@/components/CancelClassDialog';
import { CheckInButton } from '@/components/CheckInButton';
import { ChipButton } from '@/components/ChipButton';
import { StaffBookingSheet } from '@/components/StaffBookingSheet';
import { useSession } from '@/lib/auth';
import { invalidateBookingCaches } from '@/lib/bookings';
import {
  errorMessage,
  isMembershipRequiredError,
  isParqRequiredError,
  isWaiverRequiredError,
} from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import {
  planKindLabel,
  planPriceLabel,
  useGymPlans,
  useGymSelfCheckout,
  useStartCheckout,
  type GymPlan,
} from '@/lib/subscriptions';
import { useCan } from '@/lib/useCan';
import { useDependents } from '@/lib/useDependents';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';
import { dayBeforeCutoffEpoch } from '@/lib/zoned-time';

type SessionDetail = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  notes: string | null;
  gym_id: string;
  coach_id: string | null;
  recurrence_id: string | null;
  class_types: {
    name: string;
    color: string;
    cancel_cutoff_minutes_before: number | null;
    cancel_cutoff_mode: 'relative' | 'day_before' | null;
    cancel_cutoff_time: string | null;
    cancel_cutoff_days_before: number | null;
  } | null;
  coach: { full_name: string | null; avatar_url: string | null } | null;
};

type Booking = {
  id: string;
  profile_id: string;
  attended_at: string | null;
  no_show: boolean;
  promoted_from_waitlist: boolean;
  used_entitlement_kind: 'comp_grant' | 'plan_subscription' | null;
  used_entitlement_id: string | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

type WaitlistEntry = {
  rank: number;
  profile_id: string;
  joined_at: string;
};

type BookingEntitlement = {
  kind: 'comp_grant' | 'plan_subscription';
  id: string;
  is_default: boolean;
  label: string;
};

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function fmtDateParam(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

export function ClassDetailModal({
  visible,
  sessionId,
  mode,
  recommended,
  onClose,
}: {
  visible: boolean;
  sessionId: string | null;
  mode: 'manage' | 'book';
  recommended?: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const canCheckIn = useCan('can_check_in_member') ?? false;
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const canSeeHealthFlag = useCan('can_see_health_flag') ?? false;
  const canAssignPlan = useCan('can_assign_plan') ?? false;
  const canBroadcastClass = useCan('can_broadcast_to_class') ?? false;
  const { data: gymDefaults } = useGymOperatingDefaults();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<null | 'book' | 'cancel'>(null);
  const [needMembership, setNeedMembership] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelClass, setShowCancelClass] = useState(false);
  const [composing, setComposing] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [broadcastSent, setBroadcastSent] = useState(false);
  const [chosenEntitlement, setChosenEntitlement] =
    useState<{ kind: 'comp_grant' | 'plan_subscription'; id: string } | null>(
      null,
    );
  const [staffSheet, setStaffSheet] = useState<
    | { mode: 'add' }
    | {
        mode: 'swap';
        bookingId: string;
        profileId: string;
        profileName: string | null;
        currentKind: 'comp_grant' | 'plan_subscription' | null;
        currentId: string | null;
      }
    | null
  >(null);

  const sessionQuery = useQuery({
    queryKey: ['class-session-detail', sessionId],
    enabled: !!sessionId && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, capacity, notes, gym_id, coach_id, recurrence_id, class_types(name, color, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before), coach:profiles!coach_id(full_name, avatar_url)',
        )
        .eq('id', sessionId!)
        .single();
      if (error) throw error;
      return data as unknown as SessionDetail;
    },
  });

  const bookingsQuery = useQuery({
    queryKey: ['class-bookings', sessionId],
    enabled: !!sessionId && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, profile_id, attended_at, no_show, promoted_from_waitlist, used_entitlement_kind, used_entitlement_id, profiles!profile_id(full_name, avatar_url)',
        )
        .eq('class_session_id', sessionId!)
        .order('created_at');
      if (error) throw error;
      return data as unknown as Booking[];
    },
  });

  const myWaitlistRank = useQuery({
    queryKey: ['my-waitlist-rank', sessionId, session?.user.id],
    enabled: !!sessionId && visible && !!session?.user.id && mode === 'book',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_waitlist_rank', {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data as number | null) ?? null;
    },
  });

  // Staff with can_see_health_flag get a red PAR-Q chip next to any
  // booked attendee that has an outstanding health flag, so coaches
  // can scan the roster before class starts.
  const flagsQuery = useQuery({
    queryKey: ['attendee-flags', sessionId],
    enabled:
      !!sessionId && visible && mode === 'manage' && canSeeHealthFlag,
    queryFn: async (): Promise<Set<string>> => {
      const detail = await supabase
        .from('class_sessions')
        .select('gym_id')
        .eq('id', sessionId!)
        .single();
      if (detail.error) throw detail.error;
      const gymId = (detail.data as { gym_id: string }).gym_id;
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id')
        .eq('gym_id', gymId)
        .eq('health_flag', true);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { profile_id: string }).profile_id),
      );
    },
  });

  const staffWaitlist = useQuery({
    queryKey: ['staff-waitlist', sessionId],
    enabled: !!sessionId && visible && mode === 'manage',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('waitlist_for_session', {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []) as WaitlistEntry[];
    },
  });

  // Member-side picker. Only fetched when the user enters the confirm
  // step in book mode — staff manage views skip it. The list also tells
  // us which entitlement the server would pick by default, which we
  // preselect so single-option members never see a menu.
  const entitlements = useQuery({
    queryKey: ['booking-entitlements', sessionId, session?.user.id],
    enabled:
      !!sessionId &&
      visible &&
      mode === 'book' &&
      confirming === 'book' &&
      !!session?.user.id,
    queryFn: async (): Promise<BookingEntitlement[]> => {
      const { data, error: e } = await supabase.rpc(
        'list_booking_entitlements',
        { p_class_session_id: sessionId! },
      );
      if (e) throw e;
      return (data ?? []) as BookingEntitlement[];
    },
  });

  // Inline purchase prompt. When a booking is refused for lack of a
  // membership (0082), the modal shows the gym's plans here rather than
  // routing away. Book mode only; gymId resolves once the detail loads.
  const purchaseGymId = mode === 'book' ? sessionQuery.data?.gym_id : undefined;
  const plansQuery = useGymPlans(purchaseGymId);
  const selfCheckoutQuery = useGymSelfCheckout(purchaseGymId);
  // After checkout, return the member to this class (via the membership
  // page, which holds them while the webhook settles) so they can finish
  // booking the class that sent them to buy a plan.
  const checkout = useStartCheckout(
    purchaseGymId,
    sessionId ? { successPath: `/?checkout=success&book=${sessionId}` } : undefined,
  );

  const book = useMutation({
    mutationFn: async (
      pick: { kind: 'comp_grant' | 'plan_subscription'; id: string } | null,
    ) => {
      if (!sessionId) throw new Error('No class selected');
      const { error: e } = await supabase.rpc('book_class', {
        session_id: sessionId,
        p_entitlement_kind: pick?.kind ?? null,
        p_entitlement_id: pick?.id ?? null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.success();
      setError(null);
      setConfirming(null);
      setChosenEntitlement(null);
      invalidateBookingCaches(queryClient);
    },
    onError: (e) => {
      if (isWaiverRequiredError(e)) {
        close();
        router.push('/waiver');
        return;
      }
      if (isParqRequiredError(e)) {
        // Send the booker into the screening form so they don't see
        // the raw RPC message and have a clear next step.
        close();
        router.push('/parq');
        return;
      }
      if (isMembershipRequiredError(e)) {
        // Offer the plans inline instead of routing away, so they can
        // buy and come back to book.
        setConfirming(null);
        setError(null);
        setNeedMembership(true);
        return;
      }
      haptic.error();
      setError(errorMessage(e, 'Could not book class'));
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!sessionId || !session?.user.id) throw new Error('No class selected');
      const { error: e } = await supabase
        .from('class_bookings')
        .delete()
        .eq('class_session_id', sessionId)
        .eq('profile_id', session.user.id);
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.warning();
      setError(null);
      setConfirming(null);
      invalidateBookingCaches(queryClient);
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not cancel booking'));
    },
  });

  // Send a broadcast to everyone booked into this class. The insert
  // RLS gate on class_session_broadcasts checks can_broadcast_to_class +
  // sender_id = auth.uid(); we mirror the capability check client-side
  // so the chip never shows for someone who can't actually send.
  const broadcast = useMutation({
    mutationFn: async () => {
      const sess = sessionQuery.data;
      if (!sessionId || !session?.user.id || !sess) {
        throw new Error('Missing context');
      }
      const trimmed = broadcastBody.trim();
      if (!trimmed) throw new Error('Write a message');
      const { error: e } = await supabase
        .from('class_session_broadcasts')
        .insert({
          gym_id: sess.gym_id,
          class_session_id: sessionId,
          sender_id: session.user.id,
          body: trimmed,
        });
      if (e) throw e;
    },
    onSuccess: () => {
      setBroadcastError(null);
      setBroadcastBody('');
      setBroadcastSent(true);
      queryClient.invalidateQueries({
        queryKey: ['class-session-broadcasts'],
      });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
      // Auto-close the composer after a beat so the sender sees the
      // "Sent" confirmation, then can carry on managing the class.
      setTimeout(() => {
        setComposing(false);
        setBroadcastSent(false);
      }, 1200);
    },
    onError: (e) =>
      setBroadcastError(errorMessage(e, 'Could not send broadcast')),
  });

  const joinWaitlist = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No class selected');
      const { error: e } = await supabase.rpc('join_waitlist', {
        p_session_id: sessionId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['my-waitlist-rank', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['staff-waitlist', sessionId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not join waitlist')),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No class selected');
      const { error: e } = await supabase.rpc('leave_waitlist', {
        p_session_id: sessionId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['my-waitlist-rank', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['staff-waitlist', sessionId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not leave waitlist')),
  });

  function close() {
    setConfirming(null);
    setNeedMembership(false);
    setError(null);
    setComposing(false);
    setBroadcastBody('');
    setBroadcastError(null);
    setBroadcastSent(false);
    onClose();
  }

  const detail = sessionQuery.data;
  const bookings = bookingsQuery.data ?? [];
  const myBooking =
    session?.user.id != null
      ? bookings.find((b) => b.profile_id === session.user.id) ?? null
      : null;
  const myBookingExists = myBooking !== null;
  const start = detail ? new Date(detail.starts_at) : null;
  const end =
    detail && start
      ? new Date(start.getTime() + detail.duration_minutes * 60 * 1000)
      : null;
  const inPast = start ? start.getTime() < Date.now() : false;
  const isFull = detail ? bookings.length >= detail.capacity : false;
  // Mirror the server-side precedence in 0074: class-type day_before
  // wins, then class-type relative override, then gym relative default.
  const lateCancel = (() => {
    if (start === null || !detail) return false;
    const ct = detail.class_types;
    if (
      ct?.cancel_cutoff_mode === 'day_before' &&
      ct.cancel_cutoff_time
    ) {
      const cutoff = dayBeforeCutoffEpoch(
        detail.starts_at,
        gymDefaults?.timezone || 'UTC',
        ct.cancel_cutoff_days_before ?? 1,
        ct.cancel_cutoff_time,
      );
      return Date.now() >= cutoff;
    }
    const relativeMin =
      ct?.cancel_cutoff_minutes_before ??
      gymDefaults?.cancel_cutoff_minutes_before ??
      0;
    const cancelCutoffMs = relativeMin * 60 * 1000;
    return cancelCutoffMs > 0 && start.getTime() - cancelCutoffMs <= Date.now();
  })();

  const bookCutoffMs =
    (gymDefaults?.booking_cutoff_minutes_before ?? 0) * 60 * 1000;
  const windowMs = gymDefaults?.booking_window_hours_ahead
    ? gymDefaults.booking_window_hours_ahead * 60 * 60 * 1000
    : null;
  const booksOpenAt =
    start && windowMs !== null ? start.getTime() - windowMs : null;
  const booksCloseAt =
    start && bookCutoffMs > 0 ? start.getTime() - bookCutoffMs : null;
  const bookNotYetOpen =
    booksOpenAt !== null && Date.now() < booksOpenAt;
  const bookClosed =
    booksCloseAt !== null && Date.now() >= booksCloseAt && !inPast;
  const typeColor = detail?.class_types?.color ?? colors.primary;
  const typeName = detail?.class_types?.name ?? detail?.name ?? '';
  const coachName = detail?.coach?.full_name ?? 'Coach';

  const dateLabel = start
    ? start.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '';

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-5">
          {/* Close X — discoverable affordance on mobile where the
              tap-outside isn't obvious. Needs an explicit z-index: on
              web every sibling defaults to zIndex 0 and paints in DOM
              order, so without this the header block (a later sibling)
              renders over the corner and swallows the tap. */}
          <Pressable
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="absolute right-3 top-3 z-10 w-9 h-9 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
            <Ionicons name="close" size={20} color={colors.iconSecondary} />
          </Pressable>
          {sessionQuery.isLoading || !detail ? (
            <View className="py-6 items-center">
              <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
            </View>
          ) : (
            <>
              <View className="gap-2">
                {recommended && mode === 'book' ? (
                  <View className="self-start flex-row items-center gap-1 rounded-full border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1">
                    <Ionicons name="sparkles" size={12} color="#A855F7" />
                    <Text className="text-purple-600 dark:text-purple-300 text-[10px] font-semibold uppercase tracking-widest">
                      Recommended
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{ backgroundColor: typeColor }}
                  className="self-start rounded-full px-3 py-1">
                  <Text className="text-white text-xs font-semibold">{typeName}</Text>
                </View>
                <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
                  {dateLabel}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400">
                  {start && end ? `${fmtTime(start)} — ${fmtTime(end)}` : ''} ·{' '}
                  {detail.duration_minutes} min
                </Text>
              </View>

              <ChipButton
                className="self-start"
                label="See programming"
                icon="barbell-outline"
                tone="neutral"
                onPress={() => {
                  if (!start) return;
                  close();
                  router.push(`/programming?date=${fmtDateParam(start)}` as never);
                }}
              />

              <View className="gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Coach
                </Text>
                <View className="flex-row items-center gap-3">
                  <Avatar name={coachName} avatarUrl={detail?.coach?.avatar_url} />
                  <Text className="text-gray-900 dark:text-gray-50 font-medium">
                    {coachName}
                  </Text>
                </View>
              </View>

              <View className="gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Booked
                </Text>
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {bookings.length} / {detail.capacity}{' '}
                  {bookings.length === 1 ? 'spot' : 'spots'} taken
                </Text>
              </View>

              {detail.notes ? (
                <View className="gap-2">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                    Notes
                  </Text>
                  <Text className="text-gray-900 dark:text-gray-50">{detail.notes}</Text>
                </View>
              ) : null}

              {mode === 'manage' ? (
                <View className="gap-2">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                      Members
                    </Text>
                    <View className="flex-row gap-2">
                      {canBroadcastClass &&
                      (bookings.length > 0 || (staffWaitlist.data?.length ?? 0) > 0) ? (
                        <ChipButton
                          label="Message class"
                          icon="chatbubble-ellipses-outline"
                          tone="neutral"
                          onPress={() => {
                            setBroadcastError(null);
                            setBroadcastSent(false);
                            setComposing(true);
                          }}
                        />
                      ) : null}
                      {canAssignPlan && !inPast ? (
                        <ChipButton
                          label="Add member"
                          icon="add"
                          onPress={() => setStaffSheet({ mode: 'add' })}
                        />
                      ) : null}
                    </View>
                  </View>
                  {composing ? (
                    <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 gap-2">
                      <TextInput
                        value={broadcastBody}
                        onChangeText={setBroadcastBody}
                        placeholder="What does the class need to know?"
                        placeholderTextColor="#9CA3AF"
                        multiline
                        autoFocus
                        editable={!broadcast.isPending}
                        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 min-h-[72px]"
                      />
                      {broadcastError ? (
                        <Text className="text-red-500 dark:text-red-400 text-xs">
                          {broadcastError}
                        </Text>
                      ) : null}
                      {broadcastSent ? (
                        <Text className="text-emerald-600 dark:text-emerald-400 text-xs">
                          Sent. Closing…
                        </Text>
                      ) : null}
                      <View className="flex-row justify-end gap-2">
                        <ChipButton
                          label="Cancel"
                          icon="close"
                          tone="neutral"
                          onPress={() => {
                            setComposing(false);
                            setBroadcastBody('');
                            setBroadcastError(null);
                            setBroadcastSent(false);
                          }}
                          disabled={broadcast.isPending}
                        />
                        <ChipButton
                          label={broadcast.isPending ? 'Sending…' : 'Send'}
                          icon="send"
                          tone="filled"
                          onPress={() => broadcast.mutate()}
                          disabled={
                            broadcast.isPending || broadcastBody.trim() === ''
                          }
                        />
                      </View>
                    </View>
                  ) : null}
                  <ScrollView className="max-h-48">
                    {bookings.length === 0 ? (
                      <Text className="text-gray-500 dark:text-gray-400 text-sm">
                        No bookings yet.
                      </Text>
                    ) : (
                      <View className="gap-2">
                        {bookings.map((b) => (
                          <View
                            key={b.id}
                            className="flex-row items-center gap-3">
                            <Avatar
                              name={b.profiles?.full_name}
                              avatarUrl={b.profiles?.avatar_url}
                              size={32}
                            />
                            <View className="flex-1">
                              <View className="flex-row items-center gap-2">
                                <Text className="text-gray-900 dark:text-gray-50">
                                  {b.profiles?.full_name ?? 'Member'}
                                </Text>
                                {canSeeHealthFlag &&
                                flagsQuery.data?.has(b.profile_id) ? (
                                  <View className="bg-red-600 rounded-full px-1.5 py-0.5">
                                    <Text className="text-white text-[9px] font-bold tracking-widest">
                                      PAR-Q
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                              {b.promoted_from_waitlist ? (
                                <Text className="text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-widest">
                                  Promoted from waitlist
                                </Text>
                              ) : null}
                            </View>
                            {canAssignPlan ? (
                              <Pressable
                                onPress={() =>
                                  setStaffSheet({
                                    mode: 'swap',
                                    bookingId: b.id,
                                    profileId: b.profile_id,
                                    profileName: b.profiles?.full_name ?? null,
                                    currentKind: b.used_entitlement_kind,
                                    currentId: b.used_entitlement_id,
                                  })
                                }
                                hitSlop={6}
                                accessibilityLabel="Switch plan"
                                className="active:opacity-70 px-2 py-1">
                                <Ionicons
                                  name="swap-horizontal-outline"
                                  size={16}
                                  color={colors.iconSecondary}
                                />
                              </Pressable>
                            ) : null}
                            {canCheckIn && start && sessionId ? (
                              <CheckInButton
                                bookingId={b.id}
                                sessionId={sessionId}
                                attendedAt={b.attended_at}
                                noShow={b.no_show}
                                isOpen={
                                  Date.now() >=
                                  start.getTime() - 15 * 60 * 1000
                                }
                              />
                            ) : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </ScrollView>
                </View>
              ) : null}

              {mode === 'manage' && (staffWaitlist.data?.length ?? 0) > 0 ? (
                <View className="gap-2">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                    Waitlist
                  </Text>
                  <View className="gap-1">
                    {staffWaitlist.data!.map((w) => (
                      <View key={w.profile_id} className="flex-row items-center gap-2">
                        <Text className="text-gray-500 dark:text-gray-400 text-xs w-6">
                          #{w.rank}
                        </Text>
                        <Text className="text-gray-700 dark:text-gray-200 text-sm flex-1">
                          {w.profile_id.slice(0, 8)}…
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {mode === 'book' && myBooking?.promoted_from_waitlist ? (
                <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3">
                  <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
                    You were promoted from the waitlist for this class.
                  </Text>
                </View>
              ) : null}

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
              ) : null}

              {mode === 'book' && needMembership ? (
                <BookMembershipPrompt
                  plans={(plansQuery.data ?? []).filter(
                    // A programming-only plan can't book classes, so it
                    // isn't an answer to "membership required to book".
                    (p) => p.kind !== 'programming_only',
                  )}
                  canSelfCheckout={selfCheckoutQuery.data ?? true}
                  checkout={checkout}
                  onBack={() => setNeedMembership(false)}
                />
              ) : (
                <BookActions
                  inPast={inPast}
                  isFull={isFull}
                  myBookingExists={myBookingExists}
                  myWaitlistRank={myWaitlistRank.data ?? null}
                  confirming={confirming}
                  setConfirming={setConfirming}
                  onBook={() => book.mutate(chosenEntitlement)}
                  onCancel={() => cancel.mutate()}
                  onJoinWaitlist={() => joinWaitlist.mutate()}
                  onLeaveWaitlist={() => leaveWaitlist.mutate()}
                  bookPending={book.isPending}
                  cancelPending={cancel.isPending}
                  waitlistPending={joinWaitlist.isPending || leaveWaitlist.isPending}
                  entitlements={entitlements.data ?? null}
                  entitlementsLoading={entitlements.isLoading}
                  chosenEntitlement={chosenEntitlement}
                  setChosenEntitlement={setChosenEntitlement}
                  lateCancel={lateCancel}
                  bookNotYetOpen={bookNotYetOpen}
                  bookClosed={bookClosed}
                  booksOpenAt={booksOpenAt}
                  booksCloseAt={booksCloseAt}
                />
              )}

              {mode === 'book' && sessionId && !inPast ? (
                <DependentBookRow
                  sessionId={sessionId}
                  bookedIds={new Set(bookings.map((b) => b.profile_id))}
                />
              ) : null}

              {mode === 'manage' && canEditClasses && !inPast ? (
                <Button
                  variant="destructive"
                  onPress={() => setShowCancelClass(true)}>
                  Cancel class
                </Button>
              ) : null}

              <Button variant="secondary" onPress={close}>
                Close
              </Button>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    {detail && sessionId ? (
      <CancelClassDialog
        visible={showCancelClass}
        sessionId={sessionId}
        recurrenceId={detail.recurrence_id}
        startsAt={detail.starts_at}
        onClose={() => setShowCancelClass(false)}
        onCancelled={() => {
          setShowCancelClass(false);
          onClose();
        }}
      />
    ) : null}
    {detail && sessionId ? (
      <StaffBookingSheet
        visible={staffSheet !== null}
        mode={staffSheet?.mode ?? 'add'}
        sessionId={sessionId}
        gymId={detail.gym_id}
        bookedProfileIds={new Set(bookings.map((b) => b.profile_id))}
        swapTarget={
          staffSheet?.mode === 'swap'
            ? {
                bookingId: staffSheet.bookingId,
                profileId: staffSheet.profileId,
                profileName: staffSheet.profileName,
                currentKind: staffSheet.currentKind,
                currentId: staffSheet.currentId,
              }
            : null
        }
        onClose={() => setStaffSheet(null)}
        onSuccess={() => setStaffSheet(null)}
      />
    ) : null}
    </>
  );
}

// A guardian's children, each with a Book button, shown under the member's
// own booking action. Books the child via parent_book_dependent (no-charge
// seat); the server still enforces the child's own PAR-Q/waiver, so an
// unscreened child surfaces that error here.
function DependentBookRow({
  sessionId,
  bookedIds,
}: {
  sessionId: string;
  bookedIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const dependents = useDependents();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const kids = dependents.data ?? [];
  if (kids.length === 0) return null;

  async function bookChild(id: string) {
    setError(null);
    setPendingId(id);
    try {
      const { error: e } = await supabase.rpc('parent_book_dependent', {
        p_session_id: sessionId,
        p_dependent_id: id,
      });
      if (e) throw e;
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    } catch (e) {
      setError(errorMessage(e, 'Could not book your child'));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <View className="gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        Book a child
      </Text>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      {kids.map((k) => {
        const booked = bookedIds.has(k.id);
        return (
          <View key={k.id} className="flex-row items-center justify-between">
            <Text className="text-gray-700 dark:text-gray-200">
              {k.fullName ?? 'Child'}
            </Text>
            {booked ? (
              <Text className="text-emerald-600 dark:text-emerald-400 text-sm">
                Booked
              </Text>
            ) : (
              <ChipButton
                tone="primary"
                icon="add-outline"
                label={pendingId === k.id ? 'Booking…' : 'Book'}
                onPress={() => bookChild(k.id)}
                disabled={pendingId !== null}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

// Shown in place of the book button when the server refuses a booking
// for lack of a membership. Lists the gym's plans with a Subscribe
// button (Stripe Checkout) when self-checkout is on.
function BookMembershipPrompt({
  plans,
  canSelfCheckout,
  checkout,
  onBack,
}: {
  plans: GymPlan[];
  canSelfCheckout: boolean;
  checkout: ReturnType<typeof useStartCheckout>;
  onBack: () => void;
}) {
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          Membership required
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          You need an active membership to book this class. Pick a plan to get
          started.
        </Text>
      </View>
      {plans.length === 0 ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          No plans available yet — ask your gym to set one up.
        </Text>
      ) : (
        plans.map((plan) => (
          <View
            key={plan.plan_id}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  {plan.name}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {planKindLabel(plan)}
                </Text>
              </View>
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                {planPriceLabel(plan)}
              </Text>
            </View>
            {canSelfCheckout ? (
              <Button
                icon="card-outline"
                loading={
                  checkout.isPending && checkout.variables === plan.plan_id
                }
                onPress={() => checkout.mutate(plan.plan_id)}>
                {plan.kind === 'credit_pack' ? 'Buy pack' : 'Subscribe'}
              </Button>
            ) : null}
          </View>
        ))
      )}
      {!canSelfCheckout && plans.length > 0 ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Your gym sets up memberships for you — ask a coach.
        </Text>
      ) : null}
      {checkout.error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">
          {errorMessage(checkout.error, 'Could not start checkout')}
        </Text>
      ) : null}
      <Button variant="secondary" onPress={onBack}>
        Back
      </Button>
    </View>
  );
}

function BookActions({
  inPast,
  isFull,
  myBookingExists,
  myWaitlistRank,
  confirming,
  setConfirming,
  onBook,
  onCancel,
  onJoinWaitlist,
  onLeaveWaitlist,
  bookPending,
  cancelPending,
  waitlistPending,
  entitlements,
  entitlementsLoading,
  chosenEntitlement,
  setChosenEntitlement,
  lateCancel,
  bookNotYetOpen,
  bookClosed,
  booksOpenAt,
  booksCloseAt,
}: {
  inPast: boolean;
  isFull: boolean;
  myBookingExists: boolean;
  myWaitlistRank: number | null;
  confirming: null | 'book' | 'cancel';
  setConfirming: (v: null | 'book' | 'cancel') => void;
  onBook: () => void;
  onCancel: () => void;
  onJoinWaitlist: () => void;
  onLeaveWaitlist: () => void;
  bookPending: boolean;
  cancelPending: boolean;
  waitlistPending: boolean;
  entitlements: BookingEntitlement[] | null;
  entitlementsLoading: boolean;
  chosenEntitlement:
    | { kind: 'comp_grant' | 'plan_subscription'; id: string }
    | null;
  setChosenEntitlement: (
    v: { kind: 'comp_grant' | 'plan_subscription'; id: string } | null,
  ) => void;
  lateCancel: boolean;
  bookNotYetOpen: boolean;
  bookClosed: boolean;
  booksOpenAt: number | null;
  booksCloseAt: number | null;
}) {
  const colors = useThemeColors();
  if (inPast && !myBookingExists) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        This class has already started.
      </Text>
    );
  }
  if (confirming === 'book') {
    const hasChoice = (entitlements?.length ?? 0) > 1;
    const defaultPick =
      entitlements?.find((e) => e.is_default) ?? entitlements?.[0] ?? null;
    const selected = chosenEntitlement
      ? entitlements?.find(
          (e) =>
            e.kind === chosenEntitlement.kind && e.id === chosenEntitlement.id,
        ) ?? defaultPick
      : defaultPick;
    return (
      <View className="gap-3">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          {hasChoice
            ? 'Which membership do you want to use?'
            : 'Confirm your booking for this class?'}
        </Text>
        {entitlementsLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Checking your memberships…
          </Text>
        ) : hasChoice && entitlements ? (
          <View className="gap-2">
            {entitlements.map((e) => {
              const isSel =
                selected?.kind === e.kind && selected?.id === e.id;
              return (
                <Pressable
                  key={`${e.kind}:${e.id}`}
                  onPress={() =>
                    setChosenEntitlement({ kind: e.kind, id: e.id })
                  }
                  className={`flex-row items-center gap-2 rounded-lg px-3 py-2 border ${
                    isSel
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Ionicons
                    name={isSel ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={isSel ? colors.primary : colors.iconTertiary}
                  />
                  <Text className="text-gray-900 dark:text-gray-50 text-sm flex-1">
                    {e.label}
                  </Text>
                  {e.is_default ? (
                    <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
                      Default
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button
              variant="secondary"
              onPress={() => {
                setConfirming(null);
                setChosenEntitlement(null);
              }}>
              Back
            </Button>
          </View>
          <View className="flex-1">
            <Button
              onPress={() => {
                if (selected && hasChoice) {
                  setChosenEntitlement({
                    kind: selected.kind,
                    id: selected.id,
                  });
                }
                onBook();
              }}
              loading={bookPending}
              disabled={entitlementsLoading}>
              Yes, book
            </Button>
          </View>
        </View>
      </View>
    );
  }
  if (confirming === 'cancel') {
    return (
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          Cancel your booking for this class?
        </Text>
        {lateCancel ? (
          <Text className="text-amber-600 dark:text-amber-400 text-sm">
            Late cancel — your credit will be forfeited.
          </Text>
        ) : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button variant="secondary" onPress={() => setConfirming(null)}>
              Keep it
            </Button>
          </View>
          <View className="flex-1">
            <Button onPress={onCancel} loading={cancelPending}>
              Yes, cancel
            </Button>
          </View>
        </View>
      </View>
    );
  }
  if (myBookingExists) {
    return (
      <Button onPress={() => setConfirming('cancel')}>Cancel booking</Button>
    );
  }
  if (myWaitlistRank !== null) {
    return (
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          You're #{myWaitlistRank} on the waitlist
        </Text>
        <Button
          variant="secondary"
          onPress={onLeaveWaitlist}
          loading={waitlistPending}>
          Leave waitlist
        </Button>
      </View>
    );
  }
  if (isFull) {
    return (
      <View className="gap-2">
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          This class is full.
        </Text>
        <Button onPress={onJoinWaitlist} loading={waitlistPending}>
          Join waitlist
        </Button>
      </View>
    );
  }
  if (bookNotYetOpen) {
    const when = booksOpenAt ? new Date(booksOpenAt) : null;
    return (
      <View className="gap-1">
        <Button disabled>Booking not yet open</Button>
        {when ? (
          <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
            Books open {when.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}, {when.getHours().toString().padStart(2, '0')}:
            {when.getMinutes().toString().padStart(2, '0')}
          </Text>
        ) : null}
      </View>
    );
  }
  if (bookClosed) {
    const when = booksCloseAt ? new Date(booksCloseAt) : null;
    return (
      <View className="gap-1">
        <Button disabled>Booking closed</Button>
        {when ? (
          <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
            Closed {when.getHours().toString().padStart(2, '0')}:
            {when.getMinutes().toString().padStart(2, '0')}
          </Text>
        ) : null}
      </View>
    );
  }
  return <Button onPress={() => setConfirming('book')}>Book this class</Button>;
}
