import { useQuery } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Check } from '@/components/Check';
import { Sheet, SheetAction } from '@/components/Sheet';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type SessionRow = {
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
  onConfirm: (sessionIds: string[]) => void;
  confirmLabel?: string;
  pending?: boolean;
};

export function SessionPickerModal({
  visible,
  onClose,
  onConfirm,
  confirmLabel = 'Request cover',
  pending,
}: Props) {
  const session = useSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) setSelected(new Set());
  }, [visible]);

  const sessionsQuery = useQuery({
    queryKey: ['my-upcoming-sessions', session?.user.id],
    enabled: !!session?.user.id && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select(
          'id, name, starts_at, duration_minutes, class_types(name, color), cover_request_sessions(claimed_by)',
        )
        .eq('coach_id', session!.user.id)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      // Classes already sitting in the feed can't be offered twice —
      // request_cover would hit cover_request_sessions_open_session_uniq.
      return ((data ?? []) as unknown as SessionRow[]).filter(
        (s) => !s.cover_request_sessions.some((o) => o.claimed_by === null),
      );
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setSelected(new Set());
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title="Pick classes you need covered"
      subtitle="Coaches at this gym will see and claim them"
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
              onPress={() => onConfirm([...selected])}
              loading={pending}
              disabled={selected.size === 0}>
              {confirmLabel} ({selected.size})
            </Button>
          </SheetAction>
        </>
      }>
      <View className="pb-1">
        {sessionsQuery.isLoading ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">Loading…</Text>
        ) : sessionsQuery.error ? (
          <Text className="text-red-500 dark:text-red-400 text-[13px]">
            {errorMessage(sessionsQuery.error, 'Could not load sessions')}
          </Text>
        ) : (sessionsQuery.data ?? []).length === 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            You have no upcoming sessions.
          </Text>
        ) : (
          <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
            {(sessionsQuery.data ?? []).map((s, i) => {
              const checked = selected.has(s.id);
              const start = new Date(s.starts_at);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  className={`flex-row items-center gap-3 px-3.5 py-3 active:bg-raised dark:active:bg-raised-dk ${
                    i === 0 ? '' : 'border-t border-line dark:border-line-dk'
                  }`}>
                  <Check on={checked} />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-ink dark:text-ink-dk text-[14.5px] font-semibold">
                      {s.class_types?.name ?? s.name}
                    </Text>
                    <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
                      {start.toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      at{' '}
                      {start.toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {s.duration_minutes} min
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </Sheet>
  );
}
