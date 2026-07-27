import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import {
  dayTickState,
  formatDayLabel,
  groupSlotsByDay,
  slotKey,
  toggleDay,
  type ReopenSlot,
} from '@/lib/closure-reopen';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Props = {
  visible: boolean;
  closureId: string | null;
  closureLabel: string;
  onClose: () => void;
  onConfirm: (exclude: { recurrence_id: string; starts_at: string }[]) => void;
  pending?: boolean;
  error?: string | null;
};

function Tick({ state }: { state: 'all' | 'some' | 'none' }) {
  return (
    <View
      className={`w-5 h-5 rounded border items-center justify-center ${
        state === 'none'
          ? 'border-gray-300 dark:border-gray-600'
          : 'bg-primary border-primary'
      }`}>
      {state === 'all' ? (
        <Text className="text-white text-center text-xs leading-5">✓</Text>
      ) : state === 'some' ? (
        <View className="w-2.5 h-0.5 bg-white rounded-full" />
      ) : null}
    </View>
  );
}

export function ReopenClosureModal({
  visible,
  closureId,
  closureLabel,
  onClose,
  onConfirm,
  pending,
  error,
}: Props) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) setExcluded(new Set());
  }, [visible]);

  const slotsQuery = useQuery({
    queryKey: ['closure-reopen-preview', closureId],
    enabled: visible && !!closureId,
    queryFn: async (): Promise<ReopenSlot[]> => {
      const { data, error: rpcError } = await supabase.rpc('preview_closure_reopen', {
        p_closure_id: closureId!,
      });
      if (rpcError) throw rpcError;
      return (data ?? []) as unknown as ReopenSlot[];
    },
  });

  const slots = slotsQuery.data ?? [];
  const days = groupSlotsByDay(slots);
  const selected = slots.filter((s) => !excluded.has(slotKey(s)));
  const lifts = slots.length > 0 && excluded.size === 0;

  const toggleSlot = (s: ReopenSlot) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      const k = slotKey(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-lg gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Reopen classes
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            {closureLabel}. Pick the classes to put back on the calendar. Tap a
            date to take the whole day. Anyone who lost a booking to a class
            you bring back is told they need to book it again.
          </Text>

          {slots.length > 0 ? (
            <View className="flex-row gap-4">
              <Pressable onPress={() => setExcluded(new Set())} hitSlop={6}>
                <Text className="text-primary text-sm font-medium">Select all</Text>
              </Pressable>
              <Pressable
                onPress={() => setExcluded(new Set(slots.map(slotKey)))}
                hitSlop={6}>
                <Text className="text-primary text-sm font-medium">Select none</Text>
              </Pressable>
            </View>
          ) : null}

          <ScrollView className="max-h-72">
            {slotsQuery.isLoading ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Working out what would come back…
              </Text>
            ) : slotsQuery.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(slotsQuery.error, 'Could not load the classes')}
              </Text>
            ) : slots.length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                No repeating classes fall in these dates, so there is nothing to
                put back. Reopening will just end the closure.
              </Text>
            ) : (
              <View className="gap-3">
                {days.map((day) => {
                  const state = dayTickState(day, excluded);
                  return (
                    <View key={day.date} className="gap-1">
                      <Pressable
                        onPress={() => setExcluded((prev) => toggleDay(day, prev))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: state === 'all' }}
                        accessibilityLabel={`${formatDayLabel(day.date)}, ${
                          day.slots.length
                        } classes`}
                        className="flex-row items-center gap-3 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                        <Tick state={state} />
                        <Text className="flex-1 text-gray-900 dark:text-gray-50 text-sm font-medium">
                          {formatDayLabel(day.date)}
                        </Text>
                        <Text className="text-gray-500 dark:text-gray-400 text-xs">
                          {day.slots.length}
                        </Text>
                      </Pressable>

                      {day.slots.map((s) => {
                        const checked = !excluded.has(slotKey(s));
                        const startsAt = new Date(s.starts_at);
                        return (
                          <Pressable
                            key={slotKey(s)}
                            onPress={() => toggleSlot(s)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked }}
                            className="flex-row items-center gap-3 pl-6 pr-2 py-1.5 rounded-lg">
                            <Tick state={checked ? 'all' : 'none'} />
                            <Text className="flex-1 text-gray-900 dark:text-gray-50 text-sm">
                              {s.class_type_name}
                            </Text>
                            <Text className="text-gray-500 dark:text-gray-400 text-xs">
                              {startsAt.toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {lifts
              ? 'Putting every class back ends the closure, so these dates are open for new classes again.'
              : 'The closure stays in force for the dates you leave unticked — nothing new can be scheduled into them until you reopen the rest.'}
          </Text>

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={onClose}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button
                onPress={() =>
                  onConfirm(
                    slots
                      .filter((s) => excluded.has(slotKey(s)))
                      .map((s) => ({
                        recurrence_id: s.recurrence_id,
                        starts_at: s.starts_at,
                      })),
                  )
                }
                loading={pending}
                disabled={
                  slotsQuery.isLoading ||
                  (slots.length > 0 && selected.length === 0)
                }>
                {lifts || slots.length === 0
                  ? 'Reopen'
                  : `Reopen ${selected.length}`}
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
