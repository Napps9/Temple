import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import {
  attendanceLabel,
  splitBookings,
  type BookingRow,
} from '@/lib/bookings';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Tab = 'upcoming' | 'waitlisted' | 'past';

type WaitlistRow = {
  id: string;
  class_session_id: string;
  position: number;
  class_sessions: {
    starts_at: string;
    duration_minutes: number;
    class_types: { name: string; color: string } | null;
  } | null;
};

type ServerBooking = {
  id: string;
  class_session_id: string;
  attended_at: string | null;
  no_show: boolean;
  promoted_from_waitlist: boolean;
  class_sessions: {
    starts_at: string;
    duration_minutes: number;
    class_types: { name: string; color: string } | null;
  } | null;
};

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fmtTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export default function BookingsScreen() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const bookings = useQuery({
    queryKey: ['my-bookings', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, class_session_id, attended_at, no_show, promoted_from_waitlist, class_sessions(starts_at, duration_minutes, class_types(name, color))',
        )
        .eq('profile_id', session!.user.id);
      if (error) throw error;
      return (data ?? []) as unknown as ServerBooking[];
    },
  });

  const waitlist = useQuery({
    queryKey: ['my-waitlist', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('class_waitlist')
        .select(
          'id, class_session_id, position, class_sessions!inner(starts_at, duration_minutes, class_types(name, color))',
        )
        .eq('profile_id', session!.user.id)
        .gt('class_sessions.starts_at', nowIso);
      if (error) throw error;
      return (data ?? []) as unknown as WaitlistRow[];
    },
  });

  const rows: BookingRow[] = (bookings.data ?? [])
    .filter((b) => b.class_sessions)
    .map((b) => ({
      id: b.id,
      class_session_id: b.class_session_id,
      starts_at: b.class_sessions!.starts_at,
      duration_minutes: b.class_sessions!.duration_minutes,
      class_type_name: b.class_sessions!.class_types?.name ?? null,
      class_type_color: b.class_sessions!.class_types?.color ?? null,
      attended_at: b.attended_at,
      no_show: b.no_show,
      promoted_from_waitlist: b.promoted_from_waitlist,
    }));

  const { upcoming, past } = splitBookings(rows);

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from('class_bookings')
        .delete()
        .eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      setCancelError(null);
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    },
    onError: (e) => setCancelError(errorMessage(e, 'Could not cancel booking')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            My bookings
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Your upcoming classes and past attendance.
          </Text>
        </View>

        <View className="flex-row gap-2 flex-wrap">
          <TabChip
            label={`Upcoming (${upcoming.length})`}
            active={tab === 'upcoming'}
            onPress={() => setTab('upcoming')}
          />
          <TabChip
            label={`Waitlisted (${waitlist.data?.length ?? 0})`}
            active={tab === 'waitlisted'}
            onPress={() => setTab('waitlisted')}
          />
          <TabChip
            label={`Past (${past.length})`}
            active={tab === 'past'}
            onPress={() => setTab('past')}
          />
        </View>

        {bookings.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : null}
        {bookings.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(bookings.error, 'Could not load bookings')}
          </Text>
        ) : null}
        {cancelError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{cancelError}</Text>
        ) : null}

        <View className="gap-2">
          {tab === 'upcoming' ? (
            upcoming.length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No upcoming classes.
              </Text>
            ) : (
              upcoming.map((r) => (
                <BookingCard
                  key={r.id}
                  row={r}
                  isPast={false}
                  onCancel={() => cancel.mutate(r.id)}
                  cancelling={cancel.isPending}
                />
              ))
            )
          ) : tab === 'waitlisted' ? (
            (waitlist.data?.length ?? 0) === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Not on any waitlists.
              </Text>
            ) : (
              waitlist.data!.map((w) => (
                <WaitlistCard key={w.id} row={w} />
              ))
            )
          ) : past.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No past bookings.
            </Text>
          ) : (
            past.map((r) => <BookingCard key={r.id} row={r} isPast />)
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function TabChip({
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
      className={`px-3 py-1 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <Text
        className={
          active
            ? 'text-primary text-sm'
            : 'text-gray-500 dark:text-gray-400 text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function BookingCard({
  row,
  isPast,
  onCancel,
  cancelling,
}: {
  row: BookingRow;
  isPast: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const start = new Date(row.starts_at);
  const typeColor = row.class_type_color ?? '#2563EB';
  const typeName = row.class_type_name ?? 'Class';
  const att = attendanceLabel(row);

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: typeColor }}
          className="self-start rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            {fmtDate(start)} · {fmtTime(start)}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {row.duration_minutes} min
          </Text>
        </View>
        {isPast ? (
          <AttendanceBadge label={att} />
        ) : onCancel ? (
          <ChipButton
            tone="red"
            label={cancelling ? 'Cancelling…' : 'Cancel'}
            icon="close"
            onPress={onCancel}
            disabled={cancelling}
          />
        ) : null}
      </View>
      {row.promoted_from_waitlist && !isPast ? (
        <View className="self-start rounded-full px-2 py-0.5 border border-amber-300 dark:border-amber-700">
          <Text className="text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
            Promoted from waitlist
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function WaitlistCard({ row }: { row: WaitlistRow }) {
  const start = row.class_sessions ? new Date(row.class_sessions.starts_at) : null;
  const typeColor = row.class_sessions?.class_types?.color ?? '#2563EB';
  const typeName = row.class_sessions?.class_types?.name ?? 'Class';
  if (!start) return null;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: typeColor }}
          className="self-start rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            {fmtDate(start)} · {fmtTime(start)}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            On waitlist — open the class to see your position
          </Text>
        </View>
      </View>
    </View>
  );
}

function AttendanceBadge({ label }: { label: ReturnType<typeof attendanceLabel> }) {
  const color =
    label === 'Attended' ? '#10B981' : label === 'No-show' ? '#F97316' : '#9CA3AF';
  return (
    <View style={{ backgroundColor: color }} className="rounded-full px-2 py-0.5">
      <Text className="text-white text-[10px] font-semibold">{label}</Text>
    </View>
  );
}
