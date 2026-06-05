import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CancelClassDialog } from '@/components/CancelClassDialog';
import { CheckInButton } from '@/components/CheckInButton';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

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
  class_types: { name: string; color: string } | null;
  coach: { full_name: string | null } | null;
};

type Booking = {
  id: string;
  profile_id: string;
  attended_at: string | null;
  no_show: boolean;
  promoted_from_waitlist: boolean;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

type WaitlistEntry = {
  rank: number;
  profile_id: string;
  joined_at: string;
};

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function ClassDetailModal({
  visible,
  sessionId,
  mode,
  onClose,
}: {
  visible: boolean;
  sessionId: string | null;
  mode: 'manage' | 'book';
  onClose: () => void;
}) {
  const session = useSession();
  const canCheckIn = useCan('can_check_in_member') ?? false;
  const canEditClasses = useCan('can_edit_classes') ?? false;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<null | 'book' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCancelClass, setShowCancelClass] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['class-session-detail', sessionId],
    enabled: !!sessionId && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, capacity, notes, gym_id, coach_id, recurrence_id, class_types(name, color), coach:profiles!coach_id(full_name)',
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
          'id, profile_id, attended_at, no_show, promoted_from_waitlist, profiles(full_name, avatar_url)',
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

  const book = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No class selected');
      const { error: e } = await supabase.rpc('book_class', { session_id: sessionId });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not book class')),
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
      setError(null);
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['my-next-booking'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not cancel booking')),
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
    setError(null);
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
  const typeColor = detail?.class_types?.color ?? '#2563EB';
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
          {sessionQuery.isLoading || !detail ? (
            <View className="py-6 items-center">
              <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
            </View>
          ) : (
            <>
              <View className="gap-2">
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

              <View className="gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Coach
                </Text>
                <View className="flex-row items-center gap-3">
                  <Avatar name={coachName} />
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
                  <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                    Members
                  </Text>
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
                              <Text className="text-gray-900 dark:text-gray-50">
                                {b.profiles?.full_name ?? 'Member'}
                              </Text>
                              {b.promoted_from_waitlist ? (
                                <Text className="text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-widest">
                                  Promoted from waitlist
                                </Text>
                              ) : null}
                            </View>
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

              <BookActions
                inPast={inPast}
                isFull={isFull}
                myBookingExists={myBookingExists}
                myWaitlistRank={myWaitlistRank.data ?? null}
                confirming={confirming}
                setConfirming={setConfirming}
                onBook={() => book.mutate()}
                onCancel={() => cancel.mutate()}
                onJoinWaitlist={() => joinWaitlist.mutate()}
                onLeaveWaitlist={() => leaveWaitlist.mutate()}
                bookPending={book.isPending}
                cancelPending={cancel.isPending}
                waitlistPending={joinWaitlist.isPending || leaveWaitlist.isPending}
              />

              {mode === 'manage' && canEditClasses && !inPast ? (
                <Pressable
                  onPress={() => setShowCancelClass(true)}
                  className="self-start px-3 py-1.5 rounded-md border border-red-300 dark:border-red-700 active:bg-red-50 dark:active:bg-red-900/20">
                  <Text className="text-red-600 dark:text-red-400 text-xs uppercase tracking-widest">
                    Cancel class
                  </Text>
                </Pressable>
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
    </>
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
}) {
  if (inPast && !myBookingExists) {
    return (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        This class has already started.
      </Text>
    );
  }
  if (confirming === 'book') {
    return (
      <View className="gap-2">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          Confirm your booking for this class?
        </Text>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button variant="secondary" onPress={() => setConfirming(null)}>
              Back
            </Button>
          </View>
          <View className="flex-1">
            <Button onPress={onBook} loading={bookPending}>
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
  return <Button onPress={() => setConfirming('book')}>Book this class</Button>;
}
