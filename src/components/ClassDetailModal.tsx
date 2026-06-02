import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type SessionDetail = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  notes: string | null;
  gym_id: string;
  coach_id: string | null;
  class_types: { name: string; color: string } | null;
  coach: { full_name: string | null } | null;
};

type Booking = {
  id: string;
  profile_id: string;
  profiles: { full_name: string | null } | null;
};

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initial = (name?.charAt(0) || '?').toUpperCase();
  const fontSize = size >= 40 ? 16 : 13;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="bg-gray-200 items-center justify-center">
      <Text className="text-gray-600 font-semibold" style={{ fontSize }}>
        {initial}
      </Text>
    </View>
  );
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
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<null | 'book' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['class-session-detail', sessionId],
    enabled: !!sessionId && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, capacity, notes, gym_id, coach_id, class_types(name, color), coach:profiles!coach_id(full_name)',
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
        .select('id, profile_id, profiles(full_name)')
        .eq('class_session_id', sessionId!)
        .order('created_at');
      if (error) throw error;
      return data as unknown as Booking[];
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
    },
    onError: (e) => setError(errorMessage(e, 'Could not cancel booking')),
  });

  function close() {
    setConfirming(null);
    setError(null);
    onClose();
  }

  const detail = sessionQuery.data;
  const bookings = bookingsQuery.data ?? [];
  const myBookingExists =
    !!session?.user.id && bookings.some((b) => b.profile_id === session.user.id);
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
          className="bg-white rounded-2xl border border-gray-200 p-6 w-full max-w-md gap-5">
          {sessionQuery.isLoading || !detail ? (
            <View className="py-6 items-center">
              <Text className="text-gray-500">Loading…</Text>
            </View>
          ) : (
            <>
              <View className="gap-2">
                <View
                  style={{ backgroundColor: typeColor }}
                  className="self-start rounded-full px-3 py-1">
                  <Text className="text-white text-xs font-semibold">{typeName}</Text>
                </View>
                <Text className="text-gray-900 text-xl font-semibold">
                  {dateLabel}
                </Text>
                <Text className="text-gray-500">
                  {start && end ? `${fmtTime(start)} — ${fmtTime(end)}` : ''} ·{' '}
                  {detail.duration_minutes} min
                </Text>
              </View>

              <View className="gap-2">
                <Text className="text-gray-400 text-xs uppercase tracking-widest">
                  Coach
                </Text>
                <View className="flex-row items-center gap-3">
                  <Avatar name={coachName} />
                  <Text className="text-gray-900 font-medium">{coachName}</Text>
                </View>
              </View>

              <View className="gap-2">
                <Text className="text-gray-400 text-xs uppercase tracking-widest">
                  Booked
                </Text>
                <Text className="text-gray-900 font-medium">
                  {bookings.length} / {detail.capacity}{' '}
                  {bookings.length === 1 ? 'spot' : 'spots'} taken
                </Text>
              </View>

              {detail.notes ? (
                <View className="gap-2">
                  <Text className="text-gray-400 text-xs uppercase tracking-widest">
                    Notes
                  </Text>
                  <Text className="text-gray-900">{detail.notes}</Text>
                </View>
              ) : null}

              {mode === 'manage' ? (
                <View className="gap-2">
                  <Text className="text-gray-400 text-xs uppercase tracking-widest">
                    Members
                  </Text>
                  <ScrollView className="max-h-48">
                    {bookings.length === 0 ? (
                      <Text className="text-gray-500 text-sm">
                        No bookings yet.
                      </Text>
                    ) : (
                      <View className="gap-2">
                        {bookings.map((b) => (
                          <View
                            key={b.id}
                            className="flex-row items-center gap-3">
                            <Avatar name={b.profiles?.full_name} size={32} />
                            <Text className="text-gray-900">
                              {b.profiles?.full_name ?? 'Member'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </ScrollView>
                </View>
              ) : null}

              {error ? <Text className="text-red-500">{error}</Text> : null}

              {mode === 'book' ? (
                <BookActions
                  inPast={inPast}
                  isFull={isFull}
                  myBookingExists={myBookingExists}
                  confirming={confirming}
                  setConfirming={setConfirming}
                  onBook={() => book.mutate()}
                  onCancel={() => cancel.mutate()}
                  bookPending={book.isPending}
                  cancelPending={cancel.isPending}
                />
              ) : (
                <Button variant="secondary" onPress={close}>
                  Close
                </Button>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BookActions({
  inPast,
  isFull,
  myBookingExists,
  confirming,
  setConfirming,
  onBook,
  onCancel,
  bookPending,
  cancelPending,
}: {
  inPast: boolean;
  isFull: boolean;
  myBookingExists: boolean;
  confirming: null | 'book' | 'cancel';
  setConfirming: (v: null | 'book' | 'cancel') => void;
  onBook: () => void;
  onCancel: () => void;
  bookPending: boolean;
  cancelPending: boolean;
}) {
  if (inPast && !myBookingExists) {
    return <Text className="text-gray-500 text-sm">This class has already started.</Text>;
  }
  if (confirming === 'book') {
    return (
      <View className="gap-2">
        <Text className="text-gray-900 font-medium">
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
        <Text className="text-gray-900 font-medium">
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
      <Button variant="secondary" onPress={() => setConfirming('cancel')}>
        Cancel booking
      </Button>
    );
  }
  if (isFull) {
    return <Text className="text-gray-500 text-sm">This class is full.</Text>;
  }
  return <Button onPress={() => setConfirming('book')}>Book this class</Button>;
}
