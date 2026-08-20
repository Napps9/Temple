import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { Check } from '@/components/Check';
import { DatePicker } from '@/components/DatePicker';
import { Sheet, SheetAction } from '@/components/Sheet';
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
    <Sheet
      visible={visible}
      title="Pick the dates you need covered"
      subtitle="Anything scheduled into the window later is offered automatically"
      onClose={close}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={close}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              onPress={() =>
                onConfirm({ start, end, excludeSessionIds: [...excluded] })
              }
              loading={pending}
              disabled={!window || previewQuery.isLoading}>
              Request cover ({selectedCount})
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 pb-1">
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
            className="text-red-500 dark:text-red-400 text-[13px]">
            {rangeError}
          </Text>
        ) : null}

        {window ? (
          previewQuery.isLoading ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
              Finding your classes…
            </Text>
          ) : previewQuery.error ? (
            <Text className="text-red-500 dark:text-red-400 text-[13px]">
              {errorMessage(previewQuery.error, 'Could not load your classes')}
            </Text>
          ) : rows.length === 0 ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] leading-5">
              You have no classes scheduled in this window yet. You can still
              request cover — anything added later will be offered automatically.
            </Text>
          ) : (
            <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
              {rows.map((r, i) => {
                const offered = alreadyOffered(r);
                const checked = !offered && !excluded.has(r.id);
                const startsAt = new Date(r.starts_at);
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => (offered ? undefined : toggle(r.id))}
                    disabled={offered}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: offered }}
                    className={`flex-row items-center gap-3 px-3.5 py-3 ${
                      offered ? '' : 'active:bg-raised dark:active:bg-raised-dk'
                    } ${i === 0 ? '' : 'border-t border-line dark:border-line-dk'}`}>
                    <Check on={checked} />
                    <View className="flex-1 gap-0.5">
                      <Text
                        className={`text-[14.5px] font-semibold ${
                          offered
                            ? 'text-ink-3 dark:text-ink-3-dk'
                            : 'text-ink dark:text-ink-dk'
                        }`}>
                        {r.class_types?.name ?? r.name}
                      </Text>
                      <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
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
          )
        ) : null}
      </View>
    </Sheet>
  );
}
