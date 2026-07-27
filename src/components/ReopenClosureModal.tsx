import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// A slot is identified by the pattern that produces it, not by a session
// id — the classes being reopened do not exist yet.
export type ReopenSlot = {
  recurrence_id: string;
  starts_at: string;
  class_type_name: string;
  duration_minutes: number;
  capacity: number;
};

type Props = {
  visible: boolean;
  closureId: string | null;
  closureLabel: string;
  onClose: () => void;
  onConfirm: (exclude: { recurrence_id: string; starts_at: string }[]) => void;
  pending?: boolean;
  error?: string | null;
};

const slotKey = (s: ReopenSlot) => `${s.recurrence_id}@${s.starts_at}`;

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
  const selected = slots.filter((s) => !excluded.has(slotKey(s)));
  const lifts = slots.length > 0 && excluded.size === 0;

  const toggle = (s: ReopenSlot) => {
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
            {closureLabel}. Pick the classes to put back on the calendar.
            Bookings are not restored — those members were refunded and will
            need to book again.
          </Text>

          <ScrollView className="max-h-64">
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
              <View className="gap-2">
                {slots.map((s) => {
                  const checked = !excluded.has(slotKey(s));
                  const startsAt = new Date(s.starts_at);
                  return (
                    <Pressable
                      key={slotKey(s)}
                      onPress={() => toggle(s)}
                      className="flex-row items-center gap-3 p-2 rounded-lg">
                      <View
                        className={`w-5 h-5 rounded border ${
                          checked
                            ? 'bg-primary border-primary'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                        {checked ? (
                          <Text className="text-white text-center text-xs leading-5">
                            ✓
                          </Text>
                        ) : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-gray-900 dark:text-gray-50">
                          {s.class_type_name}
                        </Text>
                        <Text className="text-gray-500 dark:text-gray-400 text-xs">
                          {startsAt.toLocaleDateString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}{' '}
                          at{' '}
                          {startsAt.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                    </Pressable>
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
