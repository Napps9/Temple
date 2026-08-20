import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Check } from '@/components/Check';
import { Sheet, SheetAction } from '@/components/Sheet';
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
    <Sheet
      visible={visible}
      title="Reopen classes"
      subtitle={closureLabel}
      onClose={onClose}
      dialogWidth={520}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
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
                slotsQuery.isLoading || (slots.length > 0 && selected.length === 0)
              }>
              {lifts || slots.length === 0 ? 'Reopen' : `Reopen ${selected.length}`}
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 pb-1">
        <Text className="text-ink-2 dark:text-ink-2-dk text-[13.5px] leading-5">
          Pick the classes to put back on the calendar. Tap a date to take the
          whole day. Anyone who lost a booking to a class you bring back is told
          they need to book it again.
        </Text>

        {slots.length > 0 ? (
          <View className="flex-row gap-4">
            <Pressable onPress={() => setExcluded(new Set())} hitSlop={6}>
              <Text className="text-link text-[13px] font-semibold">
                Select all
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setExcluded(new Set(slots.map(slotKey)))}
              hitSlop={6}>
              <Text className="text-link text-[13px] font-semibold">
                Select none
              </Text>
            </Pressable>
          </View>
        ) : null}

        {slotsQuery.isLoading ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            Working out what would come back…
          </Text>
        ) : slotsQuery.error ? (
          <Text className="text-red-500 dark:text-red-400 text-[13px]">
            {errorMessage(slotsQuery.error, 'Could not load the classes')}
          </Text>
        ) : slots.length === 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] leading-5">
            No repeating classes fall in these dates, so there is nothing to put
            back. Reopening will just end the closure.
          </Text>
        ) : (
          <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
            {days.map((day, di) => {
              const state = dayTickState(day, excluded);
              return (
                <View key={day.date}>
                  <Pressable
                    onPress={() => setExcluded((prev) => toggleDay(day, prev))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: state === 'all' }}
                    accessibilityLabel={`${formatDayLabel(day.date)}, ${
                      day.slots.length
                    } classes`}
                    className={`flex-row items-center gap-3 px-3.5 py-2.5 bg-raised dark:bg-raised-dk ${
                      di === 0 ? '' : 'border-t border-line dark:border-line-dk'
                    }`}>
                    <Check on={state === 'all'} partial={state === 'some'} />
                    <Text className="flex-1 text-ink dark:text-ink-dk text-[13.5px] font-semibold">
                      {formatDayLabel(day.date)}
                    </Text>
                    <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
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
                        className="flex-row items-center gap-3 pl-8 pr-3.5 py-2.5 border-t border-line dark:border-line-dk active:bg-raised dark:active:bg-raised-dk">
                        <Check on={checked} />
                        <Text className="flex-1 text-ink dark:text-ink-dk text-[13.5px]">
                          {s.class_type_name}
                        </Text>
                        <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
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

        <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] leading-4">
          {lifts
            ? 'Putting every class back ends the closure, so these dates are open for new classes again.'
            : 'The closure stays in force for the dates you leave unticked — nothing new can be scheduled into them until you reopen the rest.'}
        </Text>

        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-red-500 dark:text-red-400 text-[13px]">
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
