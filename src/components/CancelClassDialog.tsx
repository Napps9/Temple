import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';

type Scope = 'one' | 'from' | 'series';

type Props = {
  visible: boolean;
  sessionId: string;
  recurrenceId: string | null;
  startsAt: string;
  onClose: () => void;
  onCancelled: () => void;
};

// Pattern formatting for recurring-series descriptions in the dialog.
// e.g. fmtPattern([1,3], ['17:30']) → "Mondays and Wednesdays at 17:30".
// Kept narrow on purpose — same names PostgreSQL hands back from
// class_recurrences.days_of_week (0=Sunday).
const DAY_LABELS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

function fmtDays(days: number[]): string {
  if (days.length === 0) return '';
  if (days.length === 7) return 'Every day';
  const set = new Set(days);
  const isWeekdays =
    days.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d));
  if (isWeekdays) return 'Weekdays';
  const isWeekends = days.length === 2 && set.has(0) && set.has(6);
  if (isWeekends) return 'Weekends';
  const sorted = [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]);
  if (sorted.length === 1) return sorted[0]!;
  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]}`;
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

function fmtTimes(times: string[]): string {
  if (times.length === 0) return '';
  if (times.length === 1) return `at ${times[0]}`;
  if (times.length === 2) return `at ${times[0]} and ${times[1]}`;
  return `at ${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

function fmtPattern(days: number[], times: string[]): string {
  return [fmtDays(days), fmtTimes(times)].filter(Boolean).join(' ');
}

function fmtEnds(endsOn: string | null): string {
  if (!endsOn) return '';
  const d = new Date(endsOn);
  const label = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return ` · ends ${label}`;
}

export function CancelClassDialog({
  visible,
  sessionId,
  recurrenceId,
  startsAt,
  onClose,
  onCancelled,
}: Props) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>('one');
  const [error, setError] = useState<string | null>(null);

  // Impact counts: bookings on this session, plus (for recurring) the count
  // of future sibling sessions affected by "this and future" / "whole series".
  const impact = useQuery({
    queryKey: ['cancel-class-impact', sessionId, recurrenceId],
    enabled: visible,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [thisBookings, thisWaitlist, fromSiblings, seriesSiblings] = await Promise.all([
        supabase
          .from('class_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('class_session_id', sessionId),
        supabase
          .from('class_waitlist')
          .select('id', { count: 'exact', head: true })
          .eq('class_session_id', sessionId),
        recurrenceId
          ? supabase
              .from('class_sessions')
              .select('id', { count: 'exact', head: true })
              .eq('recurrence_id', recurrenceId)
              .gte('starts_at', startsAt)
              .gt('starts_at', nowIso)
          : Promise.resolve({ count: 1 } as { count: number | null }),
        recurrenceId
          ? supabase
              .from('class_sessions')
              .select('id', { count: 'exact', head: true })
              .eq('recurrence_id', recurrenceId)
              .gt('starts_at', nowIso)
          : Promise.resolve({ count: 1 } as { count: number | null }),
      ]);
      return {
        thisBookings: thisBookings.count ?? 0,
        thisWaitlist: thisWaitlist.count ?? 0,
        fromSiblings: fromSiblings.count ?? 1,
        seriesSiblings: seriesSiblings.count ?? 1,
      };
    },
  });

  // For recurring sessions, fetch the pattern (day(s) + time(s) + ends_on)
  // so the dialog can describe "Tuesdays at 17:30" rather than "360
  // sessions". Lets the operator make the call on the basis of the
  // schedule shape, not the materialisation count.
  const recurrence = useQuery({
    queryKey: ['cancel-class-recurrence', recurrenceId],
    enabled: visible && !!recurrenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_recurrences')
        .select('days_of_week, times, ends_on')
        .eq('id', recurrenceId!)
        .single();
      if (error) throw error;
      return data as { days_of_week: number[]; times: string[]; ends_on: string | null };
    },
  });

  const patternLabel = recurrence.data
    ? `${fmtPattern(recurrence.data.days_of_week, recurrence.data.times)}${fmtEnds(
        recurrence.data.ends_on,
      )}`
    : '…';

  // The "from this date" anchor for the "This and all future" option —
  // explicit calendar date instead of the vaguer "earlier sessions".
  // Same source as the modal header so the boundary is named, not implied.
  const anchorDate = new Date(startsAt).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (scope === 'one' || !recurrenceId) {
        const { error: e } = await supabase.rpc('cancel_session', {
          p_session_id: sessionId,
        });
        if (e) throw e;
        return;
      }
      if (scope === 'from') {
        const { error: e } = await supabase.rpc('cancel_recurrence_from', {
          p_session_id: sessionId,
        });
        if (e) throw e;
        return;
      }
      const { error: e } = await supabase.rpc('cancel_recurrence', {
        p_recurrence_id: recurrenceId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.warning();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['class-sessions-month'] });
      queryClient.invalidateQueries({ queryKey: ['class-recurrences'] });
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['my-next-booking'] });
      onCancelled();
      onClose();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not cancel class'));
    },
  });

  function close() {
    if (cancelMut.isPending) return;
    setScope('one');
    setError(null);
    onClose();
  }

  const counts = impact.data;
  const isRecurring = !!recurrenceId;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Cancel class
          </Text>

          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Members lose access to this class. Credit-pack and comp credits are
            refunded automatically. Members on unlimited plans don't lose
            anything.
          </Text>

          {isRecurring ? (
            <View className="gap-2">
              <ScopeOption
                label="Just this one"
                effect="The rest of the series keeps running"
                selected={scope === 'one'}
                onPress={() => setScope('one')}
                detail={
                  counts
                    ? `${counts.thisBookings} booking${
                        counts.thisBookings === 1 ? '' : 's'
                      } · ${counts.thisWaitlist} waitlisted`
                    : '…'
                }
              />
              <ScopeOption
                label="This and all future"
                effect={`Any sessions in this series before ${anchorDate} will not be cancelled`}
                selected={scope === 'from'}
                onPress={() => setScope('from')}
                detail={`${patternLabel}, from this date onward`}
              />
              <ScopeOption
                label="The whole series"
                effect="Past sessions kept as history; the recurring schedule is removed"
                selected={scope === 'series'}
                onPress={() => setScope('series')}
                detail={patternLabel}
              />
            </View>
          ) : counts ? (
            <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-1">
              <Text className="text-gray-700 dark:text-gray-200 text-sm">
                {counts.thisBookings} booking{counts.thisBookings === 1 ? '' : 's'}{' '}
                will be cancelled.
              </Text>
              <Text className="text-gray-700 dark:text-gray-200 text-sm">
                {counts.thisWaitlist} waitlist entr
                {counts.thisWaitlist === 1 ? 'y' : 'ies'} will be removed.
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}

          <View className="flex-row gap-2 justify-end">
            <Button variant="secondary" onPress={close}>
              Keep it
            </Button>
            <Button onPress={() => cancelMut.mutate()} loading={cancelMut.isPending}>
              Cancel class
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ScopeOption({
  label,
  effect,
  detail,
  selected,
  onPress,
}: {
  label: string;
  effect: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-lg p-3 border ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700'
      }`}>
      <View className="flex-row items-center gap-2">
        <View
          className={`w-4 h-4 rounded-full border ${
            selected
              ? 'bg-primary border-primary'
              : 'border-gray-400 dark:border-gray-500'
          }`}
        />
        <Text
          className={
            selected
              ? 'text-primary font-medium'
              : 'text-gray-900 dark:text-gray-50 font-medium'
          }>
          {label}
        </Text>
      </View>
      <Text className="text-gray-700 dark:text-gray-200 text-xs mt-1 ml-6">
        {effect}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 ml-6">
        {detail}
      </Text>
    </Pressable>
  );
}
