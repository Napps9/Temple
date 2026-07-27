import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { useGymMembership, useSession } from '@/lib/auth';
import { dateRangeWindow, validateDateRange } from '@/lib/date-range';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';

type PreviewRow = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  class_types: { name: string; color: string } | null;
  cover_request_sessions: { claimed_by: string | null }[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (args: {
    start: string;
    end: string;
    excludeSessionIds: string[];
  }) => void;
  pending?: boolean;
};

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function CoverRangeModal({ visible, onClose, onConfirm, pending }: Props) {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const { data: defaults } = useGymOperatingDefaults();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) {
      setStart('');
      setEnd('');
      setExcluded(new Set());
    }
  }, [visible]);

  const tz = defaults?.timezone ?? 'UTC';
  const rangeError =
    start || end ? validateDateRange(start, end, tz, new Date()) : null;
  const window = rangeError ? null : dateRangeWindow(start, end, tz);

  // Materialise before previewing so the list matches what
  // request_cover_range will actually attach — recurrences are only
  // expanded to the gym's horizon (12 weeks by default), which a
  // Christmas window requested in July sits well beyond.
  const previewQuery = useQuery({
    queryKey: ['cover-range-preview', membership?.gymId, session?.user.id, start, end],
    enabled: visible && !!membership?.gymId && !!session?.user.id && !!window,
    queryFn: async (): Promise<PreviewRow[]> => {
      const { error: extendError } = await supabase.rpc('extend_gym_recurrences', {
        p_gym_id: membership!.gymId,
        p_until: end,
      });
      if (extendError) throw extendError;

      const nowIso = new Date().toISOString();
      const from = window!.startIso > nowIso ? window!.startIso : nowIso;
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, class_types(name, color), cover_request_sessions(claimed_by)',
        )
        .eq('gym_id', membership!.gymId)
        .eq('coach_id', session!.user.id)
        .gte('starts_at', from)
        .lt('starts_at', window!.endIso)
        .order('starts_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PreviewRow[];
    },
  });

  const rows = previewQuery.data ?? [];
  const alreadyOffered = (r: PreviewRow) =>
    r.cover_request_sessions.some((o) => o.claimed_by === null);
  const selectable = rows.filter((r) => !alreadyOffered(r));
  const selectedCount = selectable.filter((r) => !excluded.has(r.id)).length;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setExcluded(new Set());
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-lg gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Pick the dates you need covered
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Every class you coach between these dates goes into the cover
            feed. Anything scheduled into the window later is offered
            automatically.
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

          {window ? (
            <ScrollView className="max-h-64">
              {previewQuery.isLoading ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  Finding your classes…
                </Text>
              ) : previewQuery.error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
                  {errorMessage(previewQuery.error, 'Could not load your classes')}
                </Text>
              ) : rows.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  You have no classes scheduled in this window yet. You can
                  still request cover — anything added later will be offered
                  automatically.
                </Text>
              ) : (
                <View className="gap-2">
                  {rows.map((r) => {
                    const offered = alreadyOffered(r);
                    const checked = !offered && !excluded.has(r.id);
                    const startsAt = new Date(r.starts_at);
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => (offered ? undefined : toggle(r.id))}
                        disabled={offered}
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
                          <Text
                            className={
                              offered
                                ? 'text-gray-400 dark:text-gray-500'
                                : 'text-gray-900 dark:text-gray-50'
                            }>
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
                            {offered ? ' · already offered' : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button
                onPress={() =>
                  onConfirm({ start, end, excludeSessionIds: [...excluded] })
                }
                loading={pending}
                disabled={!window || previewQuery.isLoading}>
                Request cover ({selectedCount})
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
