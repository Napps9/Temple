import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { router } from 'expo-router';

import { ChipButton } from '@/components/ChipButton';
import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { ClassDetailModal } from '@/components/ClassDetailModal';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHead } from '@/components/PageHead';
import { useSession } from '@/lib/auth';
import { SectionLabel } from '@/components/SectionLabel';
import {
  attendanceLabel,
  describeCancelPolicy,
  groupUpcomingBookings,
  invalidateBookingCaches,
  isLateCancel,
  splitBookings,
  type BookingRow,
  type CancelCutoffClassType,
} from '@/lib/bookings';
import { errorMessage } from '@/lib/errors';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { labelOn } from '@/lib/contrast';

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
    class_types:
      | ({ name: string; color: string } & NonNullable<CancelCutoffClassType>)
      | null;
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
  const [confirmCancel, setConfirmCancel] = useState<BookingRow | null>(null);
  const { data: gymDefaults } = useGymOperatingDefaults();
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const bookings = useQuery({
    queryKey: ['my-bookings', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, class_session_id, attended_at, no_show, promoted_from_waitlist, class_sessions(starts_at, duration_minutes, class_types(name, color, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before))',
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
      cancelCutoffs: b.class_sessions!.class_types ?? null,
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
      setConfirmCancel(null);
      invalidateBookingCaches(queryClient);
    },
    onError: (e) => setCancelError(errorMessage(e, 'Could not cancel booking')),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc('leave_waitlist', {
        p_session_id: sessionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setWaitlistError(null);
      queryClient.invalidateQueries({ queryKey: ['my-waitlist'] });
    },
    onError: (e) =>
      setWaitlistError(errorMessage(e, 'Could not leave the waitlist')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/book" />
        <PageHead
          title="My bookings"
          subtitle="Your upcoming classes and past attendance."
        />

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
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : null}
        {bookings.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(bookings.error, 'Could not load bookings')}
          </Text>
        ) : null}
        {cancelError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{cancelError}</Text>
        ) : null}
        {waitlistError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{waitlistError}</Text>
        ) : null}

        <View className="gap-2">
          {tab === 'upcoming' ? (
            upcoming.length === 0 ? (
              <EmptyState
                icon="calendar-clear-outline"
                title="No upcoming classes"
                description="Find a class you like and book it — it shows up here."
                actionLabel="Find a class"
                actionIcon="calendar-outline"
                onAction={() => router.push('/book' as never)}
              />
            ) : (
              <>
                {groupUpcomingBookings(
                  upcoming,
                  gymDefaults?.week_starts_on ?? 'mon',
                ).map((g) => (
                  <View key={g.label} className="gap-2">
                    <SectionLabel>{g.label}</SectionLabel>
                    {g.rows.map((r) => (
                      <BookingCard
                        key={r.id}
                        row={r}
                        isPast={false}
                        onCancel={() => setConfirmCancel(r)}
                        cancelling={cancel.isPending}
                      />
                    ))}
                  </View>
                ))}
                {(() => {
                  const line = describeCancelPolicy(upcoming, gymDefaults);
                  return line ? (
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs pt-1">
                      {line}
                    </Text>
                  ) : null;
                })()}
              </>
            )
          ) : tab === 'waitlisted' ? (
            (waitlist.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="hourglass-outline"
                title="Not on any waitlists"
                description="Full classes offer a waitlist spot — you're first in line when someone drops out."
              />
            ) : (
              waitlist.data!.map((w) => (
                <WaitlistCard
                  key={w.id}
                  row={w}
                  onOpen={() => setOpenSessionId(w.class_session_id)}
                  onLeave={() => leaveWaitlist.mutate(w.class_session_id)}
                  leaving={
                    leaveWaitlist.isPending &&
                    leaveWaitlist.variables === w.class_session_id
                  }
                />
              ))
            )
          ) : past.length === 0 ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="No past bookings"
              description="Attendance for classes you've been to lands here."
            />
          ) : (
            past.map((r) => <BookingCard key={r.id} row={r} isPast />)
          )}
        </View>
      </ScrollView>

      <ClassDetailModal
        visible={!!openSessionId}
        sessionId={openSessionId}
        mode="book"
        onClose={() => setOpenSessionId(null)}
      />
      <ConfirmDialog
        visible={!!confirmCancel}
        title="Cancel this booking?"
        body={
          confirmCancel &&
          isLateCancel(
            confirmCancel.starts_at,
            confirmCancel.cancelCutoffs ?? null,
            gymDefaults,
          )
            ? 'Late cancel — your credit will be forfeited.'
            : 'Your spot goes back to the class.'
        }
        confirmLabel="Yes, cancel"
        cancelLabel="Keep it"
        pending={cancel.isPending}
        error={cancelError}
        onConfirm={() => confirmCancel && cancel.mutate(confirmCancel.id)}
        onCancel={() => {
          setConfirmCancel(null);
          setCancelError(null);
        }}
      />
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
          ? 'border-transparent bg-raised dark:bg-raised-dk'
          : 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
      }`}>
      <Text
        className={
          active
            ? 'text-ink dark:text-ink-dk text-sm font-semibold'
            : 'text-ink-2 dark:text-ink-2-dk text-sm'
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
  const colors = useThemeColors();
  const start = new Date(row.starts_at);
  const typeColor = row.class_type_color ?? colors.primary;
  const typeName = row.class_type_name ?? 'Class';
  const att = attendanceLabel(row);

  return (
    <ListRow
      lead={
        <View
          style={{ backgroundColor: typeColor }}
          className="self-start rounded-full px-2 py-0.5">
          <Text
            style={{ color: labelOn(typeColor) }}
            className="text-[10px] font-semibold">
            {typeName}
          </Text>
        </View>
      }
      title={`${fmtDate(start)} · ${fmtTime(start)}`}
      subtitle={`${row.duration_minutes} min`}
      foot={
        row.promoted_from_waitlist && !isPast ? (
          <View className="self-start rounded-full px-2 py-0.5 border border-amber-300 dark:border-amber-700 mt-1">
            <Text className="text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
              Promoted from waitlist
            </Text>
          </View>
        ) : null
      }
      trailing={
        isPast ? (
          <AttendanceBadge label={att} />
        ) : onCancel ? (
          <ChipButton
            tone="red"
            label={cancelling ? 'Cancelling…' : 'Cancel'}
            icon="close"
            onPress={onCancel}
            disabled={cancelling}
          />
        ) : (
          <View />
        )
      }
    />
  );
}

function WaitlistCard({
  row,
  onOpen,
  onLeave,
  leaving,
}: {
  row: WaitlistRow;
  onOpen: () => void;
  onLeave: () => void;
  leaving?: boolean;
}) {
  const colors = useThemeColors();
  const start = row.class_sessions ? new Date(row.class_sessions.starts_at) : null;
  const typeColor = row.class_sessions?.class_types?.color ?? colors.primary;
  const typeName = row.class_sessions?.class_types?.name ?? 'Class';
  if (!start) return null;
  return (
    <Pressable
      onPress={onOpen}
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2 active:opacity-70">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: typeColor }}
          className="self-start rounded-full px-2 py-0.5">
          <Text
            style={{ color: labelOn(typeColor) }}
            className="text-[10px] font-semibold">
            {typeName}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-medium">
            {fmtDate(start)} · {fmtTime(start)}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {row.position === 1
              ? "You're next in line"
              : `#${row.position} on the waitlist`}
          </Text>
        </View>
        <ChipButton
          tone="red"
          label={leaving ? 'Leaving…' : 'Leave'}
          icon="close"
          onPress={onLeave}
          disabled={leaving}
        />
      </View>
    </Pressable>
  );
}

function AttendanceBadge({ label }: { label: ReturnType<typeof attendanceLabel> }) {
  const colors = useThemeColors();
  const color =
    label === 'Attended' ? '#10B981' : label === 'No-show' ? '#F97316' : colors.ink3;
  return (
    <View style={{ backgroundColor: color }} className="rounded-full px-2 py-0.5">
      <Text className="text-white text-[10px] font-semibold">{label}</Text>
    </View>
  );
}
