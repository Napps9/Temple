import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import {
  describeBulkEdit,
  describeBulkEditResult,
  validateBulkEdit,
  type BulkEditResult,
} from '@/lib/bulk-class-edit';
import { dateRangeWindow, validateDateRange } from '@/lib/date-range';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';

type PreviewRow = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  class_types: { name: string } | null;
  class_bookings: { id: string }[];
};

type Mode = 'close' | 'edit';

type Props = {
  visible: boolean;
  onClose: () => void;
  onClosureCreated: (args: {
    start: string;
    end: string;
    reason: string;
    excludeSessionIds: string[];
  }) => void;
  onEdit: (args: {
    start: string;
    end: string;
    sessionIds: string[];
    capacity: number | null;
    durationMinutes: number | null;
    shiftMinutes: number | null;
  }) => void;
  pending?: boolean;
  editResult?: BulkEditResult | null;
  error?: string | null;
};

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function BulkClassEditModal({
  visible,
  onClose,
  onClosureCreated,
  onEdit,
  pending,
  editResult,
  error,
}: Props) {
  const { data: membership } = useGymMembership();
  const { data: defaults } = useGymOperatingDefaults();
  const [mode, setMode] = useState<Mode>('close');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [capacity, setCapacity] = useState('');
  const [duration, setDuration] = useState('');
  const [shift, setShift] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!visible) {
      setMode('close');
      setStart('');
      setEnd('');
      setReason('');
      setCapacity('');
      setDuration('');
      setShift('');
      setExcluded(new Set());
      setConfirming(false);
    }
  }, [visible]);

  const tz = defaults?.timezone ?? 'UTC';
  const rangeError =
    start || end ? validateDateRange(start, end, tz, new Date()) : null;
  const window = rangeError ? null : dateRangeWindow(start, end, tz);

  // Materialise before previewing so the list matches what the RPC will
  // actually act on — recurrences only reach the gym's horizon (12 weeks
  // by default), which a Christmas closure entered in July sits well
  // beyond.
  const previewQuery = useQuery({
    queryKey: ['bulk-class-preview', membership?.gymId, start, end],
    enabled: visible && !!membership?.gymId && !!window,
    queryFn: async (): Promise<PreviewRow[]> => {
      const { error: extendError } = await supabase.rpc('extend_gym_recurrences', {
        p_gym_id: membership!.gymId,
        p_until: end,
      });
      if (extendError) throw extendError;

      const nowIso = new Date().toISOString();
      const from = window!.startIso > nowIso ? window!.startIso : nowIso;
      const { data, error: selectError } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, capacity, class_types(name), class_bookings(id)',
        )
        .eq('gym_id', membership!.gymId)
        .gte('starts_at', from)
        .lt('starts_at', window!.endIso)
        .order('starts_at', { ascending: true });
      if (selectError) throw selectError;
      return (data ?? []) as unknown as PreviewRow[];
    },
  });

  const rows = previewQuery.data ?? [];
  const selected = rows.filter((r) => !excluded.has(r.id));
  const bookingsAffected = selected.reduce((n, r) => n + r.class_bookings.length, 0);

  const editFields = validateBulkEdit(capacity, duration, shift);
  const editError = 'error' in editFields ? editFields.error : null;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitEdit = () => {
    if (!('fields' in editFields) || !window) return;
    onEdit({
      start,
      end,
      sessionIds: selected.map((r) => r.id),
      capacity: editFields.fields.capacity,
      durationMinutes: editFields.fields.durationMinutes,
      shiftMinutes: editFields.fields.shiftMinutes,
    });
  };

  const confirmBody =
    `${selected.length === 1 ? '1 class' : `${selected.length} classes`} will be cancelled` +
    (bookingsAffected > 0
      ? `, and ${bookingsAffected === 1 ? '1 booking' : `${bookingsAffected} bookings`} refunded and cancelled. Those members will be told.`
      : '. Nobody has booked into them.') +
    ' Classes scheduled into these dates later will be blocked until you reopen them.';

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
            Bulk edit the timetable
          </Text>

          <View className="flex-row gap-2">
            {(
              [
                ['close', 'Close the gym'],
                ['edit', 'Change classes'],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === value }}
                className={`flex-1 py-2 rounded-lg border items-center ${
                  mode === value
                    ? 'bg-primary border-primary'
                    : 'border-gray-300 dark:border-gray-600'
                }`}>
                <Text
                  className={`text-sm font-medium ${
                    mode === value ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                  }`}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            {mode === 'close'
              ? 'Every class between these dates is cancelled and credits are returned. Anything scheduled into the window later is blocked until you reopen it.'
              : 'Change capacity, length or start time for every class between these dates. Leave a field blank to keep it as it is.'}
          </Text>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <DatePicker
                label="From"
                value={start}
                onChange={setStart}
                min={todayIso()}
              />
            </View>
            <View className="flex-1">
              <DatePicker
                label="To"
                value={end}
                onChange={setEnd}
                min={start || todayIso()}
              />
            </View>
          </View>

          {rangeError ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {rangeError}
            </Text>
          ) : null}

          {mode === 'close' ? (
            <Input
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="Christmas closure"
            />
          ) : (
            <View className="gap-3">
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Capacity"
                    value={capacity}
                    onChangeText={setCapacity}
                    keyboardType="number-pad"
                    placeholder="Unchanged"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Length (min)"
                    value={duration}
                    onChangeText={setDuration}
                    keyboardType="number-pad"
                    placeholder="Unchanged"
                  />
                </View>
              </View>
              <Input
                label="Shift start time (minutes)"
                value={shift}
                onChangeText={setShift}
                placeholder="Unchanged — use -60 to move an hour earlier"
              />
            </View>
          )}

          {window ? (
            <ScrollView className="max-h-64">
              {previewQuery.isLoading ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Finding the classes…
                </Text>
              ) : previewQuery.error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
                  {errorMessage(previewQuery.error, 'Could not load the classes')}
                </Text>
              ) : rows.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {mode === 'close'
                    ? 'No classes are scheduled in this window yet. You can still close it — anything added later will be blocked.'
                    : 'No classes are scheduled in this window.'}
                </Text>
              ) : (
                <View className="gap-2">
                  {rows.map((r) => {
                    const checked = !excluded.has(r.id);
                    const startsAt = new Date(r.starts_at);
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => toggle(r.id)}
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
                            {r.class_types?.name ?? r.name}
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
                            {r.class_bookings.length > 0
                              ? ` · ${r.class_bookings.length} booked`
                              : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          ) : null}

          {mode === 'edit' && 'fields' in editFields && window ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {describeBulkEdit(editFields.fields, selected.length)}
            </Text>
          ) : null}

          {editResult ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-gray-900 dark:text-gray-50 text-sm">
              {describeBulkEditResult(editResult)}
            </Text>
          ) : null}

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}

          {mode === 'edit' && editError && (capacity || duration || shift) ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{editError}</Text>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={onClose}>
                Close
              </Button>
            </View>
            <View className="flex-1">
              {mode === 'close' ? (
                <Button
                  variant="destructive"
                  onPress={() => setConfirming(true)}
                  loading={pending}
                  disabled={!window || previewQuery.isLoading}>
                  {`Close gym (${selected.length})`}
                </Button>
              ) : (
                <Button
                  onPress={submitEdit}
                  loading={pending}
                  disabled={
                    !window ||
                    previewQuery.isLoading ||
                    !!editError ||
                    selected.length === 0
                  }>
                  {`Apply to ${selected.length}`}
                </Button>
              )}
            </View>
          </View>
        </Pressable>
      </Pressable>

      <ConfirmDialog
        visible={confirming}
        title="Close the gym for these dates?"
        body={confirmBody}
        confirmLabel="Close the gym"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onClosureCreated({
            start,
            end,
            reason,
            excludeSessionIds: [...excluded],
          });
        }}
        pending={pending}
      />
    </Modal>
  );
}
